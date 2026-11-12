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

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | S-4: "If the input stays the same, it should give the same response"; C-5 | The same command checked against the same rules always gets the same decision, no matter what was checked before it or how many times it has been checked. | With the Section 2 config, checking `git status` 100 times in a row always gives allow. Checking `rm -rf build` before or after it doesn't change that. Restarting opencode doesn't change it either. | No | Across a shuffled sequence of generated commands with repeats, each command keeps its first decision, and `git status` stays allow under the Section 2 config (invariant). | [R1: a decision never depends on earlier checks](../packages/opencode/test/permission/permission.property.test.ts) |
| R2 | C-4, O-8: expects `git status` to be allowed when it's listed as allowed; O-7 | When a command matches more than one rule, the last matching rule in the config decides, and how specific a rule is doesn't matter. The one exception is R4: a catch-all `"*": "allow"` rule can't override a deny rule for a specific command. | With `{"git *": "ask", "git status": "allow"}`, `git status` gives allow and `git push` gives ask. If you swap the two lines, `git status` gives ask. | Yes | Swapping two matching rules changes the decision to the other rule's action, for rules of any specificity, outside the R4 exception (metamorphic). | [R2: swapping two matching rules swaps the decision](../packages/opencode/test/permission/permission.property.test.ts) |
| R3 | O-7: "confusing if moving a rule changes what the agent is allowed to do"; O-4: wildcard rules are confusing; C-4 | When a later, broader rule hides an earlier, more specific rule, opencode warns the user that the specific rule will never take effect. | Loading `{"git status": "allow", "git *": "ask"}` shows a warning that `git status` is overridden by `git *`. Loading `{"git *": "ask", "git status": "allow"}` shows no warning. | No | Not selected. Not implemented in this project. | — |
| R4 | C-2: a broad allow rule should not override an explicit deny; O-3: dangerous commands stay blocked even if other rules allow commands in general; S-2 | A deny rule for a specific command can't be overridden by a catch-all `"*": "allow"` rule, wherever that rule appears in the config. | With `{"rm *": "deny", "*": "allow"}`, `rm -rf build` gives deny and `ls -la` gives allow. (Today `rm -rf build` gives allow, because the last match wins.) | No | A specific deny stays deny when a catch-all allow appears before or after it, in each way a config can write the catch-all, and commands the deny does not match still get allow (invariant). | [R4: a catch-all allow never overrides a specific deny](../packages/opencode/test/permission/permission.property.test.ts) |
| R5 | O-2: wants to be asked before anything that could delete files or break something; S-2: only allows what's explicit; C-1 | A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A user who wants unlisted commands to prompt despite the built-in `"*": "allow"` default can set `"*": "ask"`, and that setting takes effect. | With a rule list containing only `{"git status": "allow"}`, `curl example.com` and `rm -rf build` both give ask, and `git status` gives allow. With the built-in `"*": "allow"` default followed by `{"*": "ask", "git status": "allow"}`, `curl example.com` gives ask and `git status` gives allow. | Yes | A command matching none of the generated rules gives ask, and with `"*": "allow"` ahead of a user `"*": "ask"`, unlisted commands still give ask while `git status` gives allow (invariant). | [R5: a command matching no rule gives ask](../packages/opencode/test/permission/permission.property.test.ts) |
| R6 | C-3: after undoing, `npm run dev` should ask again, while `npm run build` should follow its own rules; O-4 | Clicking "always allow" only approves that command's own prefix (for example `npm run dev *`). It doesn't approve other subcommands of the same tool. | Under the Section 2 config, clicking "always allow" on `npm run dev` lets `npm run dev --port 3000` run without a prompt. `npm run build` still asks, and `rm -rf build` is still denied. | No | Not selected. | — |
| R7 | C-3: "always allow" should save a persistent rule; O-5: should last until they change it; O-6: obvious undo in settings; S-3: undo should be as easy as allow | An "always allow" choice is saved across restarts and can be undone from settings. After undoing it, opencode behaves exactly as it did before the click. | Click "always allow" on `npm run dev`, restart opencode, and `npm run dev` runs without a prompt. Undo it in settings, and `npm run dev` asks again. `npm run build` gets the same decision as before the click, and the permission config matches what it was before the click. (Today the approval is kept only in memory and is lost on restart.) | No | Not selected. Not implemented in this project. | — |
| R8 | O-9: would know something went wrong if files disappeared or the agent ran something unexpected; O-2; C-5 | If any part of a combined shell command is denied, the whole command is blocked and no part of it runs. | Under the Section 2 config, `git status && rm -rf build` is denied as a whole and `git status` doesn't run. `git status && ls` asks, because `ls` matches only `"*": "ask"`. | No | Not selected. | — |

Properties written or suggested by opencode or another AI tool: R1, R2, R4, and R5, including their generators, were written with Claude Code, which also drafted the `evaluate()` fix for R4. I am responsible for reviewing the properties and how they tie to the interview evidence.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R2 | When a command matches more than one rule, the last matching rule in the config decides. How specific a rule is doesn't matter. | When a command matches more than one rule, the last matching rule in the config decides, and how specific a rule is doesn't matter. The one exception is R4: a catch-all `"*": "allow"` rule can't override a deny rule for a specific command. | Conflict. R2 and R4 could not both hold for `{"rm *": "deny", "*": "allow"}`: R2 required allow and R4 required deny. R4 is kept as written because C-2 and O-3 both asked for it and a wrong allow is the riskier mistake. The ordering behavior users rely on stays. |
| R5 | A command that matches no rule gives ask. It is never allowed silently. | A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A user who wants unlisted commands to prompt despite the built-in `"*": "allow"` default can set `"*": "ask"`, and that setting takes effect. | Conflict. The P3 table marked this as already implemented, but the built-in defaults begin with `"*": "allow"`, so in the real app an unlisted command usually matches a rule and is allowed. Making every unlisted command prompt would meet O-2 and S-2 but bring back the repeated prompts C-1 complained about. The revision keeps what O-2 and S-2 needed, a way to require a prompt for anything not explicitly allowed, without changing the default for everyone. |

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
| R1 | Passed | — | No change |
| R2 | Passed | — | No change |
| R4 | Failed | Code bug | Fixed `evaluate()` |
| R5 | Passed | — | No change |

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
| H1 | R2 | `permission/index.ts`: `evaluate()` takes `rules[0]` instead of `rules.at(-1)`, so the first matching rule decides instead of the last. | R2 property. Swapping two matching rules would no longer change the decision. | Pending |
| H2 | R4 | `permission/index.ts`: the catch-all check looks only at the rule just before the catch-all (`rules.at(-2)`) instead of the last specific rule. `{"rm *": "deny", "*": "ask"}` followed by `"*": "allow"` now allows `rm -rf build`. | None: should survive. The R4 generator only ever puts the deny and the catch-all next to each other, so the rule before the catch-all is always the deny. | Pending |
| H3 | R5 | `permission/index.ts`: when no rules are configured at all, the fallback is allow instead of ask. | R5 property. Its generator can produce an empty config, and then an unmatched command gives allow. | Pending |
| H4 | R1 | `core/util/wildcard.ts`: compiled patterns are cached with the `g` flag. `RegExp.test` then keeps `lastIndex` between calls, so a repeated check of the same command can flip between match and no match. | R1 property. It checks the same commands repeatedly, so the second check would not match the first. | Pending |
| H5 | R8 | `permission/index.ts`: in `ask()`, an allowed part of a combined command returns early instead of continuing, so `git status && rm -rf build` is never checked past `git status`. | None among the properties: R8 has no property, and the properties call `evaluate()`, not `ask()`. The older `ask` tests in `next.test.ts` may still catch it. | Pending |
