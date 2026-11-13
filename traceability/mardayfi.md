# Traceability: Micah Ardayfio (mardayfi)

**Target feature:** Permission rules: the config-driven allow / ask / deny decision opencode makes before the agent runs a tool, such as a shell command.

Main source files:

- [Rule evaluation, approvals, and config loading](../packages/opencode/src/permission/index.ts)
- [Wildcard matching used by rule evaluation](../packages/core/src/util/wildcard.ts)
- [Command prefixes used for "always allow"](../packages/opencode/src/permission/arity.ts)
- [Built-in default rules](../packages/opencode/src/agent/agent.ts)

The Project 3 workbook linked `packages/opencode/src/util/wildcard.ts`, but `permission/index.ts` imports the copy in `packages/core`, so that is the file listed here.

Requirements mention the "Section 2 config" from the workbook:

```json
"permission": { "edit": "ask", "bash": { "*": "ask", "git status": "allow", "rm *": "deny" } }
```

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | S-4: "If the input stays the same, it should give the same response"; C-5 | The same command checked against the same rules always gets the same decision, no matter what was checked before it or how many times it has been checked. | With the Section 2 config, checking `git status` 100 times in a row always gives allow. Checking `rm -rf build` before or after it doesn't change that. Restarting opencode doesn't change it either. | No | Across a shuffled sequence of generated commands with repeats, each command keeps its first decision, and `git status` stays allow under the Section 2 config (invariant). | [R1: a decision never depends on earlier checks](../packages/opencode/test/permission/permission.property.test.ts) | H1, H4 |
| R2 | C-4, O-8: expects `git status` to be allowed when it's listed as allowed; O-7 | When a command matches more than one rule, the last matching rule in the config decides, and how specific a rule is doesn't matter. The one exception is R4: a catch-all `"*": "allow"` rule can't override a deny rule for a specific command. | With `{"git *": "ask", "git status": "allow"}`, `git status` gives allow and `git push` gives ask. If you swap the two lines, `git status` gives ask. | Yes | Swapping two matching rules changes the decision to the other rule's action, for rules of any specificity, outside the R4 exception (metamorphic). | [R2: swapping two matching rules swaps the decision](../packages/opencode/test/permission/permission.property.test.ts) | H1, H4 |
| R3 | O-7: "confusing if moving a rule changes what the agent is allowed to do"; O-4: wildcard rules are confusing; C-4 | When a later, broader rule hides an earlier, more specific rule, opencode warns the user that the specific rule will never take effect. | Loading `{"git status": "allow", "git *": "ask"}` shows a warning that `git status` is overridden by `git *`. Loading `{"git *": "ask", "git status": "allow"}` shows no warning. | No | Not selected. Not implemented in this project. | — | — |
| R4 | C-2: a broad allow rule should not override an explicit deny; O-3: dangerous commands stay blocked even if other rules allow commands in general; S-2 | A deny rule for a specific command can't be overridden by a catch-all `"*": "allow"` rule, wherever that rule appears in the config. | With `{"rm *": "deny", "*": "allow"}`, `rm -rf build` gives deny and `ls -la` gives allow. (Today `rm -rf build` gives allow, because the last match wins.) | No | A specific deny stays deny when a catch-all allow appears before or after it, in each way a config can write the catch-all, and commands the deny does not match still get allow (invariant). | [R4: a catch-all allow never overrides a specific deny](../packages/opencode/test/permission/permission.property.test.ts) | H1, H2, H4 |
| R5 | O-2: wants to be asked before anything that could delete files or break something; S-2: only allows what's explicit; C-1 | A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A user who wants unlisted commands to prompt despite the built-in `"*": "allow"` default can set `"*": "ask"`, and that setting takes effect. | With a rule list containing only `{"git status": "allow"}`, `curl example.com` and `rm -rf build` both give ask, and `git status` gives allow. With the built-in `"*": "allow"` default followed by `{"*": "ask", "git status": "allow"}`, `curl example.com` gives ask and `git status` gives allow. | Yes | A command matching none of the generated rules gives ask, and with `"*": "allow"` ahead of a user `"*": "ask"`, unlisted commands still give ask while `git status` gives allow (invariant). | [R5: a command matching no rule gives ask](../packages/opencode/test/permission/permission.property.test.ts) | H1, H3, H4 |
| R6 | C-3: after undoing, `npm run dev` should ask again, while `npm run build` should follow its own rules; O-4 | Clicking "always allow" only approves that command's own prefix (for example `npm run dev *`). It doesn't approve other subcommands of the same tool. | Under the Section 2 config, clicking "always allow" on `npm run dev` lets `npm run dev --port 3000` run without a prompt. `npm run build` still asks, and `rm -rf build` is still denied. | No | Not selected. | — | — |
| R7 | C-3: "always allow" should save a persistent rule; O-5: should last until they change it; O-6: obvious undo in settings; S-3: undo should be as easy as allow | An "always allow" choice is saved across restarts and can be undone from settings. After undoing it, opencode behaves exactly as it did before the click. | Click "always allow" on `npm run dev`, restart opencode, and `npm run dev` runs without a prompt. Undo it in settings, and `npm run dev` asks again. `npm run build` gets the same decision as before the click, and the permission config matches what it was before the click. (Today the approval is kept only in memory and is lost on restart.) | No | Not selected. Not implemented in this project. | — | — |
| R8 | O-9: would know something went wrong if files disappeared or the agent ran something unexpected; O-2; C-5 | If any part of a combined shell command is denied, the whole command is blocked and no part of it runs. | Under the Section 2 config, `git status && rm -rf build` is denied as a whole and `git status` doesn't run. `git status && ls` asks, because `ls` matches only `"*": "ask"`. | No | For generated combined commands whose parts are allowed, prompted, or denied, `Permission.ask` blocks the whole command when any part is denied, prompts once when no part is denied but some part needs approval, and succeeds only when every part is allowed, matching a part-by-part oracle (model / oracle). Added in Project 5. | [R8: a combined command is blocked when any part is denied](../packages/opencode/test/permission/permission.property.test.ts) | H1, H4, H5 |

Properties written or suggested by opencode or another AI tool: R1, R2, R4, and R5, including their generators, were written with Claude Code, which also drafted the `evaluate()` fix for R4. In Project 5, Claude Code also wrote the R8 property and the stronger R4 generator, and designed the hand-written mutants with me. I am responsible for reviewing the properties and how they tie to the interview evidence.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R2 | When a command matches more than one rule, the last matching rule in the config decides. How specific a rule is doesn't matter. | When a command matches more than one rule, the last matching rule in the config decides, and how specific a rule is doesn't matter. The one exception is R4: a catch-all `"*": "allow"` rule can't override a deny rule for a specific command. | H1, H4 |
| R5 | A command that matches no rule gives ask. It is never allowed silently. | A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A user who wants unlisted commands to prompt despite the built-in `"*": "allow"` default can set `"*": "ask"`, and that setting takes effect. | H1, H3, H4 |

R1, R3, R4, R6, R7, and R8 are kept as written. They can each be built and checked, and R3 and R7 are future work rather than requirement problems.

## Generators and test boundaries

- Commands use tools from the interviews, including ones that share a first word (`git status` and `git push`), so broad and narrow rules overlap.
- Arguments cover the matcher's boundaries: no arguments (`rm` must match `rm *`), glob and regex characters, backslashes, newlines, and unicode.
- Patterns are derived from the command being checked, because random patterns almost never match, and the interesting cases are the ones where several rules match at once.
- R1 rebuilds the rules from config on each check. That models a restart at the rule-loading level but is not a real process restart.
- R5 uses the same `"*": "allow"` rule that `agent.ts` puts first, not the full built-in defaults.

## Run, triage, and fix

| Property | First result | Outcome | What I did |
|---|---|---|---|
| R1 | Passed | — | H1, H4 |
| R2 | Passed | — | H1, H4 |
| R4 | Failed | Code bug | H1, H2, H4 |
| R5 | Passed | — | H1, H3, H4 |

R4 failed on its first run (seed `1849103876`, path `0:0:0:1:1:1`). fast-check shrank the counterexample to a deny on `git status` followed by `"*": "allow"`, which gave allow. That is the case R4 rules out, so the code was wrong rather than the property. `evaluate()` used the last matching rule. Now, when that rule is a catch-all allow, it checks the last matching non-catch-all rule and returns it if it is a deny. An explicit exception such as `{"rm *": "deny", "rm foo": "allow", "*": "allow"}` still allows `rm foo`, as R2 requires, and a catch-all deny can still be overridden by a later catch-all allow.

Two tests in `next.test.ts` asserted the old behavior, that a trailing `*` allow overrides an exact deny. They contradict R4, so I changed them to expect deny and added two tests for the cases above.

Known risk, not fixed here: session "always allow" rules are evaluated after config rules, so an approval like `npm run dev *` may override a narrower config deny such as `npm run dev --force`. This comes from reading `ask()` and has not been confirmed by a test. R6 was not selected for a property in this project.

Local verification:

- All four properties pass, along with `test/permission`, `test/permission-task.test.ts`, `test/agent/agent.test.ts`, `test/tool/read.test.ts`, `test/tool/grep.test.ts`, `test/tool/shell.test.ts` (23 passed), and `test/session/prompt.test.ts` (75 passed, 1 skipped).
- `bun typecheck` in `packages/opencode` passes.
- These files were run one at a time. The full package suite was not run locally, so PR CI is the check for it.

The `opencode` test script uses `--only-failures`, which hides passing tests, so `.github/workflows/test.yml` has a step that runs the property file directly. That makes each property appear in the PR test log.

## Hand-written mutants

Each mutant is a patch in [`mutants/mardayfi/`](../mutants/mardayfi/). Predictions were written and committed before any mutant was run. A mutant is killed when at least one property in [`permission.property.test.ts`](../packages/opencode/test/permission/permission.property.test.ts) fails with the patch applied.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R2 | `permission/index.ts`: `evaluate()` takes `rules[0]` instead of `rules.at(-1)`, so the first matching rule decides instead of the last. | R2 property. Swapping two matching rules would no longer change the decision. | Killed by R2, as predicted, and also by R1 and R5. R2 shrank to `git status` with `{"git status": "allow"}` then `{"*": "ask"}`. R1 and R5 failed because their configs put a `"*"` rule first, so the first match was always the catch-all. The older `next.test.ts` tests also caught it (16 failures). |
| H2 | R4 | `permission/index.ts`: the catch-all check looks only at the rule just before the catch-all (`rules.at(-2)`) instead of the last specific rule. `{"rm *": "deny", "*": "ask"}` followed by `"*": "allow"` now allows `rm -rf build`. | None: should survive. The R4 generator only ever puts the deny and the catch-all next to each other, so the rule before the catch-all is always the deny. | Survived all four properties, as predicted. Three older `next.test.ts` tests caught it, including "catch-all allow still overrides a catch-all deny". This is a gap in the R4 generator, which never places a second catch-all between the deny and the allow. After strengthening (see below), the R4 property kills it. |
| H3 | R5 | `permission/index.ts`: when no rules are configured at all, the fallback is allow instead of ask. | R5 property. Its generator can produce an empty config, and then an unmatched command gives allow. | Killed by R5 only, as predicted. It shrank to `git status -rf` with an empty config, which gave allow. The older empty-ruleset tests in `next.test.ts` also caught it. |
| H4 | R1 | `core/util/wildcard.ts`: compiled patterns are cached with the `g` flag. `RegExp.test` then keeps `lastIndex` between calls, so a repeated check of the same command can flip between match and no match. | R1 property. It checks the same commands repeatedly, so the second check would not match the first. | Killed by R1, as predicted, and also by R2, R4, and R5. R1 shrank to checking `git status` twice. The second check of a cached pattern starts from the end of the string, so it does not match. Every property repeats a pattern, so all four failed. |
| H5 | R8 | `permission/index.ts`: in `ask()`, an allowed part of a combined command returns early instead of continuing, so `git status && rm -rf build` is never checked past `git status`. | None among the properties: R8 has no property, and the properties call `evaluate()`, not `ask()`. The older `ask` tests in `next.test.ts` may still catch it. | Survived all four properties, as predicted. One older test, "ask - checks all patterns and stops on first deny", caught it. R8 has no property, so this behavior is only covered by that example test. After the R8 property was added (see below), it kills H5. |

The "Mutants it kills" column counts the properties as they stand after strengthening, so it includes R8 and the stronger R4 generator. A requirement with no property has none, even when an older example test caught a mutant aimed at it.

## Stryker comparison

Config: [`packages/opencode/stryker.mardayfi.config.json`](../packages/opencode/stryker.mardayfi.config.json). Report: [`mutants/mardayfi/mutation.html`](../mutants/mardayfi/mutation.html). Run with `bunx stryker run stryker.mardayfi.config.json` from `packages/opencode`.

- **Seed:** `fc.configureGlobal({ seed: 42 })` at the top of the property file, so every Stryker run sees the same inputs.
- **Command:** `bun test test/permission/permission.property.test.ts`. Only my properties run, not opencode's existing tests.
- **Mutated code:** `src/permission/index.ts` lines 28–37 (`evaluate()`), 70–72 and 74–82 (the decision loop in `ask()`), and 185–201 (`fromConfig()` and `merge()`). These are the functions the properties call. `expand()` (home-directory paths) is left out because no requirement covers it, and line 73 is left out because it only writes a debug log.

| Run | Scope | Score | Killed | Survived |
|---|---|---|---|---|
| 1. Before strengthening | `evaluate()`, `fromConfig()`, `merge()` | 95.35% | 41 | 2 |
| 2. Before strengthening | Also the `ask()` loop, including the log line | 86.44% | 51 | 8 |
| 3. Final | Also the `ask()` loop, without the log line | **92.86%** | 52 | 4 |

**Final score:** 92.86% as Stryker reports it (52 of 56). Excluding the two equivalent mutants below, it is 96.30% (52 of 54).

**Which of my hand-written mutants did Stryker never generate, and why?** None of the five. Stryker changes one token or expression at a time from a fixed list of operators, such as flipping `===`, emptying a string, or replacing a condition with `true`. H1 (`rules[0]` instead of `rules.at(-1)`) and H2 (`rules.at(-2)` instead of `findLast`) replace one method call with a different one, which is not in that list. The closest it came was `rules.at(+1)`, which the properties killed. H3 adds a new condition, and Stryker only alters code that exists. H4 is in `packages/core/src/util/wildcard.ts`, outside my mutate range, and adding a cache is a multi-line structural change. H5 (`return` instead of `continue`) is a statement swap Stryker does not make. In run 1, H5 was also outside the mutate range.

**Which Stryker survivors would I never have thought of, and are any real bugs?** Run 2 found two I would not have designed: `if (rule.action === "allow") continue` replaced by `if (true) continue`, and `needsAsk = true` replaced by `needsAsk = false`. Both are real bugs a developer could plausibly write while refactoring the loop. A part that should prompt is silently allowed, which is the outcome O-2 and S-2 were most worried about. My first R8 property missed them because its generator only produced allow and deny rules. The other survivors are a debug log message, and the rule list attached to a denial error, which I would not have treated as risky.

**What does each approach find that the other does not?** Stryker is exhaustive over small changes: it checked every operator and branch in the code I scoped, and it showed that the `last.pattern !== "*"` check in `evaluate()` is redundant (see the equivalent mutants). It also found the missing ask case in R8. Hand-written mutants find realistic, multi-line, cross-file bugs that Stryker cannot express, and each one targets a specific requirement. H2 exposed a generator gap in R4 while Stryker scored that same code at 95%, so a high score did not mean the requirement was well tested.

## Strengthening

| Survivor | Change to the properties | Result |
|---|---|---|
| H2 | The R4 generator now places up to two extra catch-all rules of any action between the deny and the final catch-all allow, the way a user's `"*": "ask"` sits between their deny and an agent's `"bash": "allow"`. | Killed by R4. It shrank to a deny on `git status`, then `"*": "allow"`, then another `"*": "allow"`. |
| H5 | New R8 property, the first for that requirement. It calls `Permission.ask` with combined commands and checks the result against a part-by-part oracle. | Killed by R8. It shrank to `git status`, `git push`, `git status` with `git push` denied. |
| Stryker `if (true) continue` and `needsAsk = false` (line 79–80) | The R8 generator now gives each pattern allow, ask, or deny. When a prompt is expected, the property waits for it and rejects it, so a missing prompt fails. | Both killed. |

While strengthening R4, the first version failed on the real code. That was a wrong test, not a code bug: when an extra `"*": "ask"` came after the allow, an unrelated command correctly got ask under the last-match rule (R2), but the property still expected allow. The extra catch-alls now always come before the final allow.

After strengthening, all five hand-written mutants are killed (H1, H2, H3, H4, H5), and every property passes on the real code.

**Equivalent mutants:**

- **Line 32, fallback rule's pattern `"*"` changed to `""`:** The fallback rule has action ask, so the catch-all check on line 34 returns it before its pattern is read. Every caller (`ask()`, the skill and task filters, the tool registry, the prompt hint, and the debug command) reads only `.action` from the result. The only place the pattern appears is a debug log line, so the change has no effect on any decision.
- **Line 34, `last.pattern !== "*"` replaced with `false`:** This only matters when the last matching rule is an allow with a specific pattern. Then the lookup on line 35 for the last non-catch-all rule finds that same allow rule, so the function returns it either way. The condition is a shortcut, not a behavior, so no input can tell the two apart.

**Survivors that are not equivalent:** Line 76 filters the rules attached to a denial error to the ones for this tool. Replacing the filter with the full rule list, or an empty list, still blocks the command but changes which rules the error message shows the agent. No requirement covers the contents of that message, so I did not write a property for it. R8 checks that the command is blocked, and C-5 and O-9 cared about what runs, not what the error says.
