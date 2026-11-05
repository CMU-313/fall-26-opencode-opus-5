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
| R1 | S-4: "If the input stays the same, it should give the same response"; C-5 | The same command checked against the same rules always gets the same decision, no matter what was checked before it or how many times it has been checked. | With the Section 2 config, checking `git status` 100 times in a row always gives allow. Checking `rm -rf build` before or after it doesn't change that. Restarting opencode doesn't change it either. | No | Pending | Pending |
| R2 | C-4, O-8: expects `git status` to be allowed when it's listed as allowed; O-7 | When a command matches more than one rule, the last matching rule in the config decides, and how specific a rule is doesn't matter. The one exception is R4: a catch-all `"*": "allow"` rule can't override a deny rule for a specific command. | With `{"git *": "ask", "git status": "allow"}`, `git status` gives allow and `git push` gives ask. If you swap the two lines, `git status` gives ask. | Yes | Pending | Pending |
| R3 | O-7: "confusing if moving a rule changes what the agent is allowed to do"; O-4: wildcard rules are confusing; C-4 | When a later, broader rule hides an earlier, more specific rule, opencode warns the user that the specific rule will never take effect. | Loading `{"git status": "allow", "git *": "ask"}` shows a warning that `git status` is overridden by `git *`. Loading `{"git *": "ask", "git status": "allow"}` shows no warning. | No | Not selected. Not implemented in this project. | — |
| R4 | C-2: a broad allow rule should not override an explicit deny; O-3: dangerous commands stay blocked even if other rules allow commands in general; S-2 | A deny rule for a specific command can't be overridden by a catch-all `"*": "allow"` rule, wherever that rule appears in the config. | With `{"rm *": "deny", "*": "allow"}`, `rm -rf build` gives deny and `ls -la` gives allow. (Today `rm -rf build` gives allow, because the last match wins.) | No | Pending | Pending |
| R5 | O-2: wants to be asked before anything that could delete files or break something; S-2: only allows what's explicit; C-1 | A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A user who wants unlisted commands to prompt despite the built-in `"*": "allow"` default can set `"*": "ask"`, and that setting takes effect. | With a rule list containing only `{"git status": "allow"}`, `curl example.com` and `rm -rf build` both give ask, and `git status` gives allow. With the built-in `"*": "allow"` default followed by `{"*": "ask", "git status": "allow"}`, `curl example.com` gives ask and `git status` gives allow. | Yes | Pending | Pending |
| R6 | C-3: after undoing, `npm run dev` should ask again, while `npm run build` should follow its own rules; O-4 | Clicking "always allow" only approves that command's own prefix (for example `npm run dev *`). It doesn't approve other subcommands of the same tool. | Under the Section 2 config, clicking "always allow" on `npm run dev` lets `npm run dev --port 3000` run without a prompt. `npm run build` still asks, and `rm -rf build` is still denied. | No | Not selected. | — |
| R7 | C-3: "always allow" should save a persistent rule; O-5: should last until they change it; O-6: obvious undo in settings; S-3: undo should be as easy as allow | An "always allow" choice is saved across restarts and can be undone from settings. After undoing it, opencode behaves exactly as it did before the click. | Click "always allow" on `npm run dev`, restart opencode, and `npm run dev` runs without a prompt. Undo it in settings, and `npm run dev` asks again. `npm run build` gets the same decision as before the click, and the permission config matches what it was before the click. (Today the approval is kept only in memory and is lost on restart.) | No | Not selected. Not implemented in this project. | — |
| R8 | O-9: would know something went wrong if files disappeared or the agent ran something unexpected; O-2; C-5 | If any part of a combined shell command is denied, the whole command is blocked and no part of it runs. | Under the Section 2 config, `git status && rm -rf build` is denied as a whole and `git status` doesn't run. `git status && ls` asks, because `ls` matches only `"*": "ask"`. | No | Not selected. | — |

Properties written or suggested by opencode or another AI tool: Pending

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R2 | When a command matches more than one rule, the last matching rule in the config decides. How specific a rule is doesn't matter. | When a command matches more than one rule, the last matching rule in the config decides, and how specific a rule is doesn't matter. The one exception is R4: a catch-all `"*": "allow"` rule can't override a deny rule for a specific command. | Conflict. R2 and R4 could not both hold for `{"rm *": "deny", "*": "allow"}`: R2 required allow and R4 required deny. R4 is kept as written because C-2 and O-3 both asked for it and a wrong allow is the riskier mistake. The ordering behavior users rely on stays. |
| R5 | A command that matches no rule gives ask. It is never allowed silently. | A command that matches no rule, counting the built-in default rules as well as the user's config, gives ask. A user who wants unlisted commands to prompt despite the built-in `"*": "allow"` default can set `"*": "ask"`, and that setting takes effect. | Conflict. The P3 table marked this as already implemented, but the built-in defaults begin with `"*": "allow"`, so in the real app an unlisted command usually matches a rule and is allowed. Making every unlisted command prompt would meet O-2 and S-2 but bring back the repeated prompts C-1 complained about. The revision keeps what O-2 and S-2 needed, a way to require a prompt for anything not explicitly allowed, without changing the default for everyone. |
