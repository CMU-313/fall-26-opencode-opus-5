import { expect, test } from "bun:test"
import fc from "fast-check"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { Permission } from "../../src/permission"

const NUM_RUNS = 500

// A fixed seed makes every run see the same inputs, so a mutant is killed or
// survives the same way each time.
fc.configureGlobal({ seed: 42 })

// Generator choices:
// - Commands use real tools from the interviews, including ones that share a
//   first word ("git status" and "git push"), so that broad and narrow rules
//   actually overlap.
// - Arguments cover the wildcard matcher's boundaries: no arguments at all
//   ("rm" must still match "rm *"), glob and regex characters, backslashes
//   (normalized to "/"), newlines, and unicode.
// - Patterns are derived from the command being checked, because purely random
//   patterns almost never match anything and the interesting cases are the ones
//   where several rules match at once.
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

// Every pattern here matches the command, from most to least specific. "*" is
// left out because the property places the catch-all rule itself.
function specificPatterns(input: Command) {
  const firstWord = input.tool.split(" ")[0]
  return [input.text, `${input.tool} *`, `${firstWord} *`, `${firstWord}*`, `${input.text.slice(0, -1)}?`]
}

// R4: A deny rule for a specific command can't be overridden by a catch-all
// "*": "allow" rule, wherever that rule appears in the config.
// Kind: invariant
//
// The catch-all is generated in each form a config can spell it (inside the
// bash rules as "*": "allow", as "bash": "allow", and as a top-level
// "*": "allow"), and it appears both before and after the specific deny rule.
// Up to two intermediate catch-all rules of any action are inserted between
// the deny and the final allow to prevent mutants that only need to look at
// the immediately adjacent rule. The property also checks that commands the
// deny rule does not match are unaffected — they still resolve to "allow".
test("R4: a catch-all allow never overrides a specific deny", () => {
  fc.assert(
    fc.property(
      command,
      command,
      fc.nat(4),
      fc.boolean(),
      fc.constantFrom<ConfigPermissionV1.Info>({ bash: { "*": "allow" } }, { bash: "allow" }, { "*": "allow" }),
      fc.array(action, { maxLength: 2 }),
      (denied, other, index, catchAllFirst, catchAll, between) => {
        const pattern = specificPatterns(denied)[index]
        // Require that "other" is a command the deny rule does not match, so
        // the second assertion checks the non-denied path independently.
        fc.pre(!Wildcard.match(other.text, pattern))

        const deny = Permission.fromConfig({ bash: { [pattern]: "deny" } })
        const allow = Permission.fromConfig(catchAll)
        const middle = between.map((value) => Permission.fromConfig({ bash: { "*": value } }))

        // The catch-all appears before or after the specific deny to cover
        // every position the user might write it.
        const ruleset = catchAllFirst
          ? Permission.merge(...middle, allow, deny)
          : Permission.merge(deny, ...middle, allow)

        // The denied command must still resolve to "deny".
        expect(Permission.evaluate("bash", denied.text, ruleset).action).toBe("deny")
        // A command that the deny rule does not match must still resolve to
        // "allow" from the catch-all.
        expect(Permission.evaluate("bash", other.text, ruleset).action).toBe("allow")
      },
    ),
    { numRuns: NUM_RUNS },
  )
})
