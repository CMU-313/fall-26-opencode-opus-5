import { expect, test } from "bun:test"
import fc from "fast-check"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { Permission } from "../../src/permission"

const NUM_RUNS = 500

// Generator choices:
// - Commands use real tools from the interviews, including ones that share a first word ("git status" and
//   "git push"), so that broad and narrow rules actually overlap.
// - Arguments cover the wildcard matcher's boundaries: no arguments at all ("rm" must still match "rm *"), glob and
//   regex characters, backslashes (normalized to "/"), newlines, and unicode.
// - Patterns are derived from the command being checked, because purely random patterns almost never match anything
//   and the interesting cases are the ones where several rules match at once.
const tool = fc.constantFrom("git status", "git push", "npm run dev", "npm run build", "rm", "curl", "ls")
const argument = fc.constantFrom(
  "-rf",
  "build",
  "--port",
  "3000",
  "example.com",
  "*.ts",
  "a?b",
  "(x)",
  "[y]",
  "C:\\tmp",
  "line\nbreak",
  "café",
)
const command = fc
  .record({ tool, args: fc.array(argument, { maxLength: 3 }) })
  .map((value) => ({ tool: value.tool, text: [value.tool, ...value.args].join(" ") }))
const action = fc.constantFrom("allow", "ask", "deny") as fc.Arbitrary<"allow" | "ask" | "deny">
type Command = { tool: string; text: string }

// Every pattern here matches the command, from most to least specific. "*" is left out because the properties place
// the catch-all rule themselves.
function specificPatterns(input: Command) {
  const firstWord = input.tool.split(" ")[0]
  return [input.text, `${input.tool} *`, `${firstWord} *`, `${firstWord}*`, `${input.text.slice(0, -1)}?`]
}

// R1: The same command checked against the same rules always gets the same decision, no matter what was checked
// before it or how many times it has been checked.
// Kind: invariant
// Checking the commands in a shuffled order with repeats models "what was checked before". Each check rebuilds the
// rules from config, which models a restart at the rule-loading level but is not a real process restart.
test("R1: a decision never depends on earlier checks", () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(command, fc.nat(4), action), { maxLength: 6 }),
      fc.array(command, { minLength: 1, maxLength: 8 }).chain((commands) =>
        fc.shuffledSubarray([...commands, ...commands], {
          minLength: commands.length * 2,
          maxLength: commands.length * 2,
        }),
      ),
      (generated, sequence) => {
        const section2 = { "*": "ask", "git status": "allow", "rm *": "deny" } as const
        const config = Object.fromEntries(
          generated.map(([input, index, value]) => [specificPatterns(input)[index], value]),
        )
        const check = (text: string) =>
          Permission.evaluate("bash", text, Permission.fromConfig({ bash: { ...section2, ...config } })).action
        const baseline = new Map(sequence.map((input) => [input.text, check(input.text)]))

        sequence.forEach((input) => {
          expect(check(input.text)).toBe(baseline.get(input.text)!)
          expect(Permission.evaluate("bash", "git status", Permission.fromConfig({ bash: section2 })).action).toBe(
            "allow",
          )
        })
      },
    ),
    { numRuns: NUM_RUNS },
  )
})

// R2: When a command matches more than one rule, the last matching rule in the config decides, and how specific a
// rule is doesn't matter. The one exception is R4: a catch-all "*": "allow" rule can't override a deny rule for a
// specific command.
// Kind: metamorphic
// Swapping two matching rules must swap the decision to the other rule's action. Rules are built through fromConfig
// so that the test covers real config order, and non-matching rules are mixed in to show that only matching rules
// count.
test("R2: swapping two matching rules swaps the decision", () => {
  fc.assert(
    fc.property(
      command,
      fc.nat(5),
      fc.nat(5),
      action,
      action,
      fc.array(action, { maxLength: 3 }),
      (input, firstIndex, secondIndex, firstAction, secondAction, noise) => {
        const patterns = [...specificPatterns(input), "*"]
        const first = patterns[firstIndex]
        const second = patterns[secondIndex]
        fc.pre(first !== second)
        // The R4 exception is covered by its own property.
        const isException = (earlier: string, earlierAction: string, later: string, laterAction: string) =>
          later === "*" && laterAction === "allow" && earlier !== "*" && earlierAction === "deny"
        fc.pre(!isException(first, firstAction, second, secondAction))
        fc.pre(!isException(second, secondAction, first, firstAction))

        const unrelated = noise.map((value, index) => [`no-such-tool-${index}`, value])
        const decision = (earlier: string, earlierAction: string, later: string, laterAction: string) =>
          Permission.evaluate(
            "bash",
            input.text,
            Permission.fromConfig({
              bash: Object.fromEntries([...unrelated, [earlier, earlierAction], [later, laterAction], ...unrelated]),
            }),
          ).action

        expect(decision(first, firstAction, second, secondAction)).toBe(secondAction)
        expect(decision(second, secondAction, first, firstAction)).toBe(firstAction)
      },
    ),
    { numRuns: NUM_RUNS },
  )
})

// R4: A deny rule for a specific command can't be overridden by a catch-all "*": "allow" rule, wherever that rule
// appears in the config.
// Kind: invariant
// The catch-all is generated in each form a config can spell it (inside the bash rules, as "bash": "allow", and as a
// top-level "*": "allow"), both before and after the deny rule, with non-matching rules mixed in.
test("R4: a catch-all allow never overrides a specific deny", () => {
  fc.assert(
    fc.property(
      command,
      command,
      fc.nat(4),
      fc.boolean(),
      fc.constantFrom<ConfigPermissionV1.Info>({ bash: { "*": "allow" } }, { bash: "allow" }, { "*": "allow" }),
      (denied, other, index, catchAllFirst, catchAll) => {
        const pattern = specificPatterns(denied)[index]
        fc.pre(!Wildcard.match(other.text, pattern))
        const deny = Permission.fromConfig({ bash: { [pattern]: "deny" } })
        const allow = Permission.fromConfig(catchAll)
        const ruleset = catchAllFirst ? Permission.merge(allow, deny) : Permission.merge(deny, allow)

        expect(Permission.evaluate("bash", denied.text, ruleset).action).toBe("deny")
        expect(Permission.evaluate("bash", other.text, ruleset).action).toBe("allow")
      },
    ),
    { numRuns: NUM_RUNS },
  )
})

// R5: A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A
// user who wants unlisted commands to prompt despite the built-in "*": "allow" default can set "*": "ask", and that
// setting takes effect.
// Kind: invariant
// Rules are derived from other commands, with any that happen to match removed, so the rule list is non-empty and
// looks real while still matching nothing. The second half puts the same "*": "allow" default ahead of the user's
// rules, the way agent.ts merges them.
test("R5: a command matching no rule gives ask", () => {
  fc.assert(
    fc.property(command, fc.array(fc.tuple(command, fc.nat(4), action), { maxLength: 6 }), (input, generated) => {
      fc.pre(input.text !== "git status")
      const config = Object.fromEntries(
        generated
          .map(([other, index, value]) => [specificPatterns(other)[index], value] as const)
          .filter(([pattern]) => !Wildcard.match(input.text, pattern)),
      )

      expect(Permission.evaluate("bash", input.text, Permission.fromConfig({ bash: config })).action).toBe("ask")

      const withDefaults = Permission.merge(
        Permission.fromConfig({ "*": "allow" }),
        Permission.fromConfig({ bash: { "*": "ask", "git status": "allow" } }),
      )
      expect(Permission.evaluate("bash", input.text, withDefaults).action).toBe("ask")
      expect(Permission.evaluate("bash", "git status", withDefaults).action).toBe("allow")
    }),
    { numRuns: NUM_RUNS },
  )
})
