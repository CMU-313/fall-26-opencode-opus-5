# Traceability: Zachary Fan (zacharyf)

**Target feature:** File pinning (`/pin`, `/unpin`). Pinned files' current contents are sent with every message. Main source files: `packages/core/src/util/pinned.ts`, `packages/opencode/src/session/pinned.ts`, `packages/opencode/src/session/reminders.ts`, `packages/tui/src/component/prompt/pin.ts`, `packages/tui/src/feature-plugins/sidebar/pinned.tsx`.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | O-13, O-17, S-10 | Any existing file in the project can be pinned, regardless of extension or read-only status. | Pinning `src/index.ts`, a read-only file, `.env` and `.gitignore` each succeeds, and each appears in the pinned set. | No | Any generated existing path (dotfiles, multi-dot extensions, nested dirs, ignored or not) is accepted and appended to the pinned set (invariant) | [`R1: any existing file can be pinned`](../packages/tui/test/prompt/pin.property.test.ts) |
| R2 | S-8, S-9, S-11, C-8 | Pinning a file that matches `.gitignore` succeeds but shows a warning. | With `.env` in `.gitignore`, pinning `.env` adds it and warns. Pinning `src/index.ts` shows no warning. | No | `/pin` returns a warning containing "matches .gitignore" iff the file listing marks the file ignored, for every generated path (invariant) | [`R2: gitignored files are pinned with a warning, others without`](../packages/tui/test/prompt/pin.property.test.ts) |
| R3 | S-19, C-15 | Pinned file contents are read when each message is sent, not when the file is pinned. | Pin `a.ts` with `X = 1`, change it to `X = 2`, then send. The captured request contains `X = 2` and not `X = 1`. | No | Changing a pinned file from A to B changes the rendered context from A to B (metamorphic) | [`R3: edits made after pinning show up on the next send`](../packages/opencode/test/session/pinned.property.test.ts) |
| R4 | S-22, S-23, C-17, C-18 | If a pinned file is deleted or renamed, the next message shows a "file not found" error for that path. The message still sends with the remaining pins, and the pin isn't moved to the new path. | Pin `a.ts` and `b.ts`, rename `a.ts` to `c.ts`, then send. The user sees a not-found error naming `a.ts`. The request contains `b.ts` and contains neither `a.ts` nor `c.ts` as pinned content. | No | For random pins each kept, deleted or renamed, results match an oracle built from each pin's fate. The user-facing not-found message names exactly the deleted and renamed pins. The model request keeps kept contents, marks the others missing, and never includes the renamed path (model/oracle) | [`R4: deleted or renamed pins are reported to the user by path`](../packages/tui/test/prompt/pin.property.test.ts), [`R4: deleted or renamed pins are marked missing and the rest still send`](../packages/opencode/test/session/pinned.property.test.ts) |
| R5 | C-20, S-25, O-25 | Whenever at least one file is pinned, the UI shows an indicator listing exactly the pinned set. | Pin `a.ts` and `b.ts`: both are listed. Unpin `a.ts`: only `b.ts` is listed. Unpin `b.ts`: nothing is listed. | No | Any pin/unpin sequence stored through session metadata matches an ordered-set model (model/oracle). Pin then unpin returns the original set (round-trip) | [`R5: the listed pins match a set model after any pin/unpin sequence`](../packages/opencode/test/session/pinned.property.test.ts), [`R5: pin then unpin returns the original pinned set`](../packages/opencode/test/session/pinned.property.test.ts) |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, and R5 were all suggested by Claude Code Opus 5.5. They created the generators and all the test checks as well. I looked through all properties and made sure they were directly related and addressed what was brought up in interviews. 

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|

All requirements stayed the same because they were all feasible, checkable, and didn't conflict with each other. These were all aspects of the requirements I made sure were the case back in P3. That way I wouldn't have to adjust any at this stage. 
