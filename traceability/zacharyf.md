# Traceability: Zachary Fan (zacharyf)

**Target feature:** File pinning (`/pin`, `/unpin`). Pinned files' current contents are sent with every message. Main source files: `packages/core/src/util/pinned.ts`, `packages/opencode/src/session/pinned.ts`, `packages/opencode/src/session/reminders.ts`, `packages/tui/src/component/prompt/pin.ts`, `packages/tui/src/feature-plugins/sidebar/pinned.tsx`.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | O-13, O-17, S-10 | Any existing file in the project can be pinned, regardless of extension or read-only status. | Pinning `src/index.ts`, a read-only file, `.env` and `.gitignore` each succeeds, and each appears in the pinned set. | No | Any generated existing path (dotfiles, multi-dot extensions, nested dirs, ignored or not) is accepted and appended to the pinned set (invariant) | [`R1: existing files can be pinned and other paths are rejected`](../packages/tui/test/prompt/pin.property.test.ts) | H2 |
| R2 | S-8, S-9, S-11, C-8 | Pinning a file that matches `.gitignore` succeeds but shows a warning. | With `.env` in `.gitignore`, pinning `.env` adds it and warns. Pinning `src/index.ts` shows no warning. | No | `/pin` returns a warning containing "matches .gitignore" iff the file listing marks the file ignored, for every generated path (invariant) | [`R2: gitignored files are pinned with a warning, others without`](../packages/tui/test/prompt/pin.property.test.ts) | H1, H2 |
| R3 | S-19, C-15 | Pinned file contents are read when each message is sent, not when the file is pinned. | Pin `a.ts` with `X = 1`, change it to `X = 2`, then send. The captured request contains `X = 2` and not `X = 1`. | No | Changing a pinned file from A to B changes the rendered context from A to B (metamorphic) | [`R3: edits made after pinning show up on the next send`](../packages/opencode/test/session/pinned.property.test.ts) | H5 |
| R4 | S-22, S-23, C-17, C-18 | If a pinned file is deleted or renamed, the next message shows a "file not found" error for that path. The message still sends with the remaining pins, and the pin isn't moved to the new path. | Pin `a.ts` and `b.ts`, rename `a.ts` to `c.ts`, then send. The user sees a not-found error naming `a.ts`. The request contains `b.ts` and contains neither `a.ts` nor `c.ts` as pinned content. | No | For random pins each kept, deleted or renamed, results match an oracle built from each pin's fate. The user-facing not-found message names exactly the deleted and renamed pins. The model request keeps kept contents, marks the others missing, and never includes the renamed path (model/oracle) | [`R4: deleted or renamed pins are reported to the user by path`](../packages/tui/test/prompt/pin.property.test.ts), [`R4: deleted or renamed pins are marked missing and the rest still send`](../packages/opencode/test/session/pinned.property.test.ts) | H2, H3 (UI); H4 (server) |
| R5 | C-20, S-25, O-25 | Whenever at least one file is pinned, the UI shows an indicator listing exactly the pinned set. | Pin `a.ts` and `b.ts`: both are listed. Unpin `a.ts`: only `b.ts` is listed. Unpin `b.ts`: nothing is listed. | No | Any pin/unpin sequence stored through session metadata matches an ordered-set model (model/oracle). Pin then unpin returns the original set (round-trip) | [`R5: the listed pins match a set model after any pin/unpin sequence`](../packages/opencode/test/session/pinned.property.test.ts), [`R5: pin then unpin returns the original pinned set`](../packages/opencode/test/session/pinned.property.test.ts), [`R5: /pin then /unpin restores the pinned set`](../packages/tui/test/prompt/pin.property.test.ts) | H6, H7 (H7 only after the P5 strengthening) |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R4, and R5 were all suggested by Claude Code Opus 5.5. They created the generators and all the test checks as well. I looked through all properties and made sure they were directly related and addressed what was brought up in interviews. 

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|

All requirements stayed the same because they were all feasible, checkable, and didn't conflict with each other. These were all aspects of the requirements I made sure were the case back in P3. That way I wouldn't have to adjust any at this stage. 

## Hand-written mutants

Patches are in [`mutants/zacharyf/`](../mutants/zacharyf/). Predictions were written before any mutant was run.

| ID | Req | Mutant | Predicted killer | Actual |
|---|---|---|---|---|
| [H1](../mutants/zacharyf/H1.patch) | R2 | `/pin` never adds the gitignore warning (`if (entry.ignored)` → `if (false)`) | R2 (an ignored path expects `warning`) | Killed by R2 `[".env",true,""]` |
| [H2](../mutants/zacharyf/H2.patch) | R1 | The file lookup treats dotfiles as not in the project (`&& !name.startsWith(".")`) | R1 (the generator makes `.env`, `.gitignore`, … about half the time) | Killed by R1 `[[".env"],false,""]`, and also by R2 `[".env",false,""]` and R4-UI `[[[".env","0"],["keep","keep"]]]` |
| [H3](../mutants/zacharyf/H3.patch) | R4 | The lookup "follows" a rename by suffix match (`item.name.endsWith(name)`), so `renamed-a.ts` counts as `a.ts` | R4-UI (renamed pins expected in the not-found list) | Killed by R4-UI `[[["a","b"],["keep","rename"]]]` |
| [H4](../mutants/zacharyf/H4.patch) | R4 | `render` silently drops missing pins instead of emitting a `missing="true"` block | R4-server | Killed by R4-server `[[["-"],["rename"]]]` |
| [H5](../mutants/zacharyf/H5.patch) | R3 | `load` caches contents by absolute path, so later edits are never seen | R3 (reads the same path twice) | Killed by R3 `[".env",""," "]` |
| [H6](../mutants/zacharyf/H6.patch) | R5 | `withFiles` drops other session metadata keys | R5 model (checks `metadata.other` is kept) | Killed by R5 model `[[{"action":"pin","file":"a.ts"}]]` |
| [H7](../mutants/zacharyf/H7.patch) | R5 | `remove` compares the raw path, so `/unpin ./a.ts` or `/unpin @a.ts` leaves `a.ts` pinned | **Survives**: the R5 generators only produce already-normalized paths | Survived (all 7 properties pass). After the R5 round-trip was strengthened to unpin with `./` and `@` spellings, killed by R5 round-trip `[["0"],".env","","./"]` |

After the Stryker strengthening below, H1–H7 were re-run against the new properties, and all 7 are killed.

## Stryker

- **Configs:** [`packages/tui/stryker.zacharyf.config.json`](../packages/tui/stryker.zacharyf.config.json) mutates `src/component/prompt/pin.ts:22-105` (lookup, `missingPins`, `missingMessage`, token count, `runPinCommand`) with `bun test test/prompt/pin.property.test.ts`. [`packages/opencode/stryker.zacharyf.config.json`](../packages/opencode/stryker.zacharyf.config.json) mutates `src/session/pinned.ts:22-58` (`render`, `load`) with `bun test test/session/pinned.property.test.ts`. Both use the command runner with coverage analysis off. Run with `bunx stryker run stryker.zacharyf.config.json` from the package directory.
- **Not mutated:** `packages/core/src/util/pinned.ts` (`list`, `add`, `remove`, `withFiles`, `limit`). It is in another package, so Stryker can't mutate it from these sandboxes. Only H6 and H7 cover it.
- **Seed:** `fc.configureGlobal({ seed: 17313 })` at the top of both property files.
- **Reports:** [`mutants/zacharyf/mutation.html`](../mutants/zacharyf/mutation.html) (tui) and [`mutants/zacharyf/mutation-opencode.html`](../mutants/zacharyf/mutation-opencode.html) (opencode), both from the final run.

| Package | Mutants | Before: killed / survived | Before score | After: killed / survived | After raw | Equivalent | After, equivalents excluded |
|---|---|---|---|---|---|---|---|
| tui (`pin.ts`) | 129 | 60 / 69 | 46.51% | 128 / 1 | 99.22% | 1 | 128/128 = 100% |
| opencode (`session/pinned.ts`) | 32 | 16 / 16 | 50.00% | 31 / 1 | 96.88% | 1 | 31/31 = 100% |
| Total | 161 | 76 / 85 | 47.20% | 159 / 2 | 98.76% | 2 | 159/159 = 100% |

### How survivors were killed

All of them were killed by strengthening properties. No example tests were added.

| Survivors (line: what was mutated) | Why they survived | Property change |
|---|---|---|
| tui 59–60, 76–81: empty path, `../` and absolute paths, already pinned, not a file. Also 27 (`item.type === "file"` → `true`) | R1 only ever pinned new, existing files | R1 is now a model/oracle over 7 kinds of target (new, empty, outside, absolute, already pinned, missing, directory). It checks the exact error and that nothing is saved |
| tui 66–73: the whole `/unpin` branch | No TUI property ran `/unpin` | New `R5: /pin then /unpin restores the pinned set`, with `./`/`@` spellings, an unpinned path, an empty path, and a failed save |
| tui 96, 68: `if (res.error)` on save | The fake `session.update` never failed | The fake can fail a save (R1, R5) |
| tui 45–49, 85–88, 100–103: token sum, over-limit refusal, 80% warning, warning join | R2 held contents short and model undefined, so neither limit was ever reached | R2 is now a model/oracle over sizes (exact tokens), binary files, pins that no longer exist, and model limits 1–30. It checks the exact type and message |
| tui 25 (`res.error \|\| !res.data` → `false`), 39 (plural/singular, message text) | The fake list never returned an error. R4 only checked the path list after `": "` | The fake returns an error for a directory that doesn't exist. R4-UI checks the exact message, including "file"/"files" |
| opencode 23–24, 41: header line, newline join | R3/R4 only used `toContain` on single blocks | R3 checks the header line, and that each block starts on its own line |
| opencode 32–38: token cap / `omitted` | R3/R4 always used `MAX_TOKENS` with small files | New `R3: current contents are sent in pin order up to the token cap`, a model/oracle over `render` with small caps |
| opencode 50–51: outside-project guard. 54: `Effect.catch` | R4 never pinned a path outside the project or a path that became a directory | R4-server has two new fates: `outside` (a real file outside the project must not be read) and `directory` |
| (hand-written H7) | Already-normalized paths only | R5 round-trip pins and unpins with `""`/`./`/`@` |

### Equivalent mutants (claimed)

| Mutant | Argument |
|---|---|
| tui `pin.ts:25` LogicalOperator `res.error \|\| !res.data` → `res.error && !res.data` | The SDK returns either `{ error }` with no data or `{ data }` with no error, and `\|\|` and `&&` agree on both. They differ only when there is neither, which the SDK never returns. |
| opencode `session/pinned.ts:44` StringLiteral `Effect.fn("SessionPinned.load")` → `Effect.fn("")` | The string is only the tracing span name. Nothing reads it, so `load`'s result and errors are identical. |

### Comparison

- **Hand-written mutants Stryker never generated:** H2–H5, which add or reshape logic (a new condition, `===` → `endsWith`, a dropped `push`, a cache). Stryker only swaps or deletes single operators and literals. H6–H7 are in `core/util/pinned.ts`, outside both Stryker scopes. Only H1 (`if (false)`) matched a Stryker mutant.
- **Stryker survivors I wouldn't have thought of:** the whole `/unpin` path, save failures (`res.error`), the 80% token warning boundary, the outside-project guard in `load`, a pin replaced by a directory (which crashed the send), and request formatting (header, newlines).
- **What each finds:** hand-written mutants test whether the properties catch realistic, requirement-level bugs. Stryker sweeps every branch and literal, which exposed code paths no property ran at all. Hand-written killed 6/7 before strengthening. Stryker killed only 76/161 (47.2%), so Stryker found far more gaps.

## Agent failure case

- **Prompt to opencode** (dev build, TUI): "In `packages/tui/src/component/prompt/pin.ts`, `runPinCommand` implements `/pin`. Requirement R2: pinning a file that matches .gitignore succeeds but shows a warning, and pinning a file that isn't ignored shows no warning. Write a fast-check property-based test for R2 in `packages/tui/test/prompt/r2.opencode.property.test.ts`, using `bun:test` and a fake `OpencodeClient`. Write your own test; don't read or reuse `packages/tui/test/prompt/pin.property.test.ts`. Run it with `bun test test/prompt/r2.opencode.property.test.ts` from `packages/tui` and make sure it passes."
- **Transcript:** [screenshot](../mutants/zacharyf/agent-case.png): session `ses_e2dc369d1ffehWs32lo559orhr`, model ERNIE-5.5-Flash-Preview (free, via OpenRouter), 2026-11-13T00:09Z. It shows opencode running the test (1 pass, 300 `expect()` calls) and its summary. Share link: https://opncd.ai/share/o559orhr (it returned HTTP 410 Gone when fetched later).
- **opencode's property:** the first test in [`r2.opencode.property.test.ts`](../packages/tui/test/prompt/r2.opencode.property.test.ts), unchanged. It passes on the real code and kills H1.
- **Surviving mutants:**
  - [H2](../mutants/zacharyf/H2.patch): dotfiles are treated as not in the project.
  - [H8](../mutants/zacharyf/H8.patch): an ignored file returns "Pinned … matches .gitignore", but is never saved to the session. H8 was written for this case after reading opencode's property, so it has no prediction.
- **Why the property was weak:**
  - **Generator:** it never makes dotfiles, so `.env`, the main R2 example, is never pinned (H2 survives).
  - **Oracle:** it checks the returned result but never that the pin was saved, even though its fake records `updates` (H8 survives).
- **Strengthened version:** the second test in the same file. It adds 5 dotfiles to the generator and checks the exact result and that `session.update` saved `[pinned]`.
- **Evidence** ([`mutants/zacharyf/agent-case-evidence.txt`](../mutants/zacharyf/agent-case-evidence.txt), seed 20261113 from opencode's file):

| Code | opencode's property | Strengthened |
|---|---|---|
| Real code | pass | pass |
| H2 | **pass** (survives) | fail, `[".env",false,""]` |
| H8 | **pass** (survives) | fail, `[".env",true,""]` |

- **Same gap in my own R2:** it killed H8 only because the warning text didn't match, and it also didn't check the save. I added `expect(updates).toEqual([{ pinnedFiles: [...current, file] }])` to it.
