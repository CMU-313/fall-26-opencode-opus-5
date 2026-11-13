# Traceability: Takeshi Koey (tkoey)

**Target feature:** File pinning through `/pin` and `/unpin`.

Main source files:

- [Pin commands and validation](../packages/tui/src/component/prompt/pin.ts)
- [Pinned-file state, path normalization, and token limits](../packages/core/src/util/pinned.ts)
- [Loading and formatting pinned-file contents](../packages/opencode/src/session/pinned.ts)
- [Pinned-file dialog](../packages/tui/src/component/dialog-pinned-files.tsx) and [sidebar](../packages/tui/src/feature-plugins/sidebar/pinned.tsx)

## Requirements

The interview evidence, requirement wording, and acceptance criteria below are copied from my submitted P3 workbook.

| ID  | Interview evidence                                                                                                              | Requirement                                                                                                                                                                                 | Acceptance Criteria                                                                                                                                                                                                               | Changed in P4? | Property (kind)                                                                                                                                                                            | Test                                                                                                                                | Mutants it kills |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --- |
| R1  | S-1, S-3: Pinning and unpinning should not change file contents.                                                                | /pin and /unpin must preserve file contents.                                                                                                                                                | Record a.txt's contents, pin it, then unpin it. After each command, its contents match the original exactly.                                                                                                                      | No             | File bytes remain identical after each command, including other pinned files; the additional pin/unpin sequence restores the initial pin list (invariant).                                 | [R1: pin and unpin preserve file bytes after each command](../packages/tui/test/prompt/pin.tkoey.property.test.ts)                        | M3 (state check) |
| R2  | C-5: Showing the project-relative path helps distinguish files with the same filename.                                          | The pinned-file list must identify each pinned file by its project-relative path so files with identical filenames can be distinguished.                                                    | Pin src/client/config.ts and src/server/config.ts. Open the pinned-file list. Both entries display their respective project-relative paths, rather than displaying only config.ts.                                                | No             | Not selected for the minimum four properties.                                                                                                                                              | —                                                                                                                                   | — |
| R3  | S-2: The same set of pinned files should have a consistent displayed order.                                                     | The displayed order must be independent of the order files were pinned.                                                                                                                     | Pin A then B in one session and B then A in another. Both pinned-file lists display the same ordering.                                                                                                                            | No             | Shuffling or reversing pin insertion order leaves the displayed list identical and preserves every path, without changing metadata (metamorphic).                                          | [R3: displayed pin order is independent of insertion order](../packages/tui/test/prompt/pin.tkoey.property.test.ts)                       | H1, M1 |
| R4  | S-4: A file appearing pinned is insufficient; its contents must actually reach the model.                                       | Successfully pinned, readable files whose combined estimated size fits within the pinning budget must have their contents included in the next model request.                               | Pin a readable file containing DEMO_CODE = blue-giraffe-42, with total pinned content below the pinning budget. Send a message. The actual model request includes that line.                                                      | No             | A map of real readable file contents is the oracle for the complete pinned-file blocks in the actual captured HTTP model request (model/oracle).                                           | [R4: eligible pinned file contents reach the actual model request (property)](../packages/opencode/test/session/prompt.test.ts)     | H4, H5 |
| R5  | S-5: Files exceeding available context capacity should produce an error.                                                        | When a pin command would make total pinned content exceed the pinning budget, the tool must reject the new pin, display an error, and preserve existing pins.                               | With a pinning budget of 1,000 tokens and A already using 600 tokens, attempt to pin B estimated at 401 tokens. A visible command error explains that the pinning budget would be exceeded. B is not added, and A remains pinned. | No             | A command exceeding the budget returns an explanatory error and performs no metadata update. Valid commands below or exactly at the budget succeed and preserve existing pins (invariant). | [R5: command accepts within budget and rejects over budget without changing pins](../packages/tui/test/prompt/pin.tkoey.property.test.ts) | H2, H3, M2 |
| R6  | O-3: Users need to understand whether unpinning removes previously shared information or only stops future automatic inclusion. | After successfully unpinning a file, the tool must display a confirmation explaining that automatic inclusion has stopped and information already discussed may remain in the conversation. | With notes.txt pinned, run /unpin notes.txt. The visible confirmation identifies notes.txt and states: “Automatic inclusion stopped. Information already discussed may remain in this conversation.”                              | No             | Not selected for the minimum four properties. Current confirmation is only `Unpinned <path>`; R6 is retained but not implemented by this P4 change.                                        | —                                                                                                                                   | — |

Properties written or suggested by opencode or another AI tool: R1, R3, R4, and R5 were suggested and implemented with ChatGPT/Codex assistance, including generators and the R3 display fix. Earlier AI suggestions also discussed R2 and R6; neither has a dedicated property in this submission. I am responsible for reviewing the properties and their relationship to the interview evidence.

## Requirement changes

All six requirements are retained because they describe feasible, checkable behavior and do not conflict with each other. R4 is tested for inclusion in the next request; this submission does not add an edited-file refresh guarantee or a path-normalization requirement to the P3 wording.

| ID  | Original requirement (P3) | Revised requirement | Why it changed           |
| --- | ------------------------- | ------------------- | ------------------------ |
| —   | —                         | —                   | No requirements changed. |

## Generators and test boundaries

- R1 generates distinct valid nested paths (including spaces and identical basenames), empty/nonempty text, Unicode, and multiline text. The candidate starts unpinned and other files start pinned. Real temporary files are compared byte-for-byte after each actual command.
- R3 generates 2–6 distinct paths, full permutations, and reversed insertion orders. Both pinned-file UI surfaces use the same tested presentation function. The property checks that sorting does not mutate metadata or drop paths; stored pin order and model-context order remain unchanged.
- R4 generates either 1–4 small readable files (empty, Unicode, multiline, or generated text up to 200 characters each), or two ASCII files whose combined estimate is exactly the 25,000-token budget. The split varies from 1 + 24,999 tokens to 24,999 + 1; seed `42` makes the run repeatable. The existing session/prompt fixture sends a real HTTP request to a local test provider; the property compares complete file blocks with that request. It starts with valid pinned session metadata, so pin admission itself is covered separately by command properties.
- R5 generates budgets of 2–2,000 tokens and different existing usage levels, and explicitly includes P3's 1,000-token budget with 600 tokens already used. For every generated budget it checks totals one token below, exactly at, and one token above the limit. Four ASCII characters represent one token under the production estimator. A high-usage warning still counts as successful admission.
- Command properties call `runPinCommand` through the real SDK with a narrow test transport serving real temporary files and recording metadata updates. This isolates the TUI command from HTTP server behavior; unexpected transport requests fail. They verify the command result used by the UI for toasts, not a rendered toast.
- TUI tests are explicitly included in `turbo.json` so the PR unit-test workflow schedules them; OpenCode tests were already included. Explicit property steps in `.github/workflows/test.yml` also print all four passing test names, since the ordinary package scripts hide passing tests with `--only-failures`. Local results and PR CI results must be distinguished when submitting.

## Run, triage, and fix

R3 failed before sorting was added. fast-check shrank the counterexample to the same two paths, `src/0/config.ts` and `src/1/config.ts`, inserted in opposite orders (seed `2127120189`, shrink path `0:0:0:0:0:0:0`). The display used insertion order, violating R3. The fix sorts a fresh presentation list shared by the dialog and sidebar; it does not alter persisted metadata or provider-request ordering.

Local verification:

- R1, R3, and R5: all passed (100, 200, and 100 generated cases respectively; R5 checks three budget boundaries per case).
- R4: passed 100 cases against the captured local HTTP provider request.
- Full TUI suite: 200 passed, 1 skipped, 0 failed.
- Combined OpenCode prompt/pinned-file regression run: 83 passed, 1 skipped, 1 timed out (`shell completion resumes queued loop callers`). That existing shell-coordination test passed when rerun alone (5.86 seconds against its 10-second timeout). All selected pinning properties passed; the combined regression run is not claimed as fully green.
- The full OpenCode package run was stopped after approximately ten minutes without completing, so it is not claimed as passing. Two existing CLI tests initially failed because their `bun` subprocess executable was absent from `PATH`; both passed when rerun with the downloaded Bun directory on `PATH`. This local environment issue does not replace the required passing PR CI run.
- `bun typecheck` in both `packages/tui` and `packages/opencode`: passed.
- Workflow YAML parsing, Turbo scheduling of the TUI test task, and `git diff --check`: checked locally. A remote CI result still requires pushing a commit and opening the PR.

Reproduce the property checks from the relevant package directories:

```sh
cd packages/tui
bun test test/prompt/pin.tkoey.property.test.ts --timeout 30000
bun typecheck
```

```sh
cd packages/opencode
bun test test/session/prompt.test.ts --test-name-pattern '^R4:' --timeout 60000
bun typecheck
```

## Hand-written mutants

Predictions recorded before testing, against `9be05c221e067a754018be4c9c72b6ea97ae84e8`. Each patch changes one behavior and is tested separately with the existing properties.

| ID | Requirement | Change | Predicted killer | Actual result |
| --- | --- | --- | --- | --- |
| H1 | R3 | Remove display sorting; show insertion order. | R3: reversing insertion order changes the displayed list. | Killed by R3: reversed insertion order changed the display. |
| H2 | R5 | Change admission from `tokens <= max` to `tokens < max`. | R5: a pin exactly at the budget must succeed. | Killed by R5: a total exactly at the budget was rejected. |
| H3 | R5 | Count only the new file when checking the budget. | R5: existing pins can make the combined total exceed the limit. | Killed by R5: an over-budget pin returned a warning instead of an error. |
| H4 | R4 | Trim pinned contents when building the model request. | R4: complete file blocks must retain whitespace and newlines. | Killed by R4: the request lost a trailing newline. |
| H5 | R4 | Omit a file when cumulative tokens equal the request budget (`>` to `>=`). | Likely survives: R4 generates files far below the budget. | Initially survived; killed after extending R4 to generate exact-budget pairs. |


Local results (Bun 1.3.14): the unmodified TUI properties passed (3/3), and R4 passed (1/1). H1–H3 each produced 2 passes and 1 failure in the TUI property file. H4 produced an R4 assertion failure; H5 passed R4. No properties were changed for these runs.

| Mutant | Failure seed / shrink path | Small counterexample |
| --- | --- | --- |
| H1 | `1205994460` / `0:0:0` | `src/0/config.ts` and `src/0/empty.txt`, inserted in opposite orders. |
| H2 | `885652469` / `0:0:0` | Budget 2, existing usage 0: a 2-token candidate was rejected. |
| H3 | `-36195167` / `0:1:0:0:0:0:0:1:1:2:1:0:1:2:1:1:0:1:0:1:0:1:0` | Budget 2, existing usage 1: a 2-token candidate was accepted. |
| H4 | `-930829403` / `4:2` | Contents `["日本語\nline two\n", ""]`: the first file's trailing newline disappeared. |

H5 is a real boundary fault, not an equivalent mutant. A readable file that brings the total exactly to the budget should be included, but the patch omits it. The original R4 generator never reached that boundary.

To repeat: from the repo root, apply one patch with `git apply mutants/tkoey/H1.patch`, run the relevant package command below, then restore it with `git apply -R mutants/tkoey/H1.patch`. Substitute H2–H5 as needed. The recorded failure seeds and paths can be passed as `seed` and `path` in that property's `fc.assert` options for exact replay.

```sh
# H1–H3, from packages/tui
bun test test/prompt/pin.tkoey.property.test.ts --timeout 30000

# H4–H5, from packages/opencode
bun test test/session/prompt.test.ts --test-name-pattern '^R4:' --timeout 60000
```

All five patches were reversed after testing. R4 needs permission to start a local HTTP server; a sandbox-only startup failure was rerun outside the sandbox and is not counted as a kill.

### Strengthening R4

R4 now mixes the original small files with generated pairs totaling exactly 25,000 tokens. Each ASCII file has four characters per token; the split varies while the total stays at the boundary. The oracle still checks complete file blocks in the captured HTTP request.

With seed `42`, normal source passed R4 (100 cases, 217 assertions). H5 failed after 3 cases and shrank to split `1` (1 + 24,999 tokens), seed `42`, path `2:0`. The assertion failed because the second file's complete block was missing from the request. H5 was reversed afterward; `bun typecheck` and `git diff --check` passed.

```text
# H5 applied, strengthened R4
Property failed after 3 tests
{ seed: 42, path: "2:0" }
Counterexample: [1]
Expected: true
Received: false
```

## Red team

Received from [jahuang24](https://github.com/CMU-313/fall-26-opencode-opus-5/pull/20#issuecomment-6786757486). Patches are saved unchanged in `mutants/tkoey/received/`; M1–M3 follow the comment's numbering. Tested separately against `8c2cb3c` with `bun test test/prompt/pin.property.test.ts --timeout 30000` from `packages/tui` (Bun 1.3.14).

| Mutant | Stated target | Result | Changes needed |
| --- | --- | --- | --- |
| [M1](../mutants/tkoey/received/M1.patch): remove display sorting | R3 | Killed by R3: reversing insertion order changes the display. | None. |
| [M2](../mutants/tkoey/received/M2.patch): count only the last file's tokens | R5 | Killed by R5: 1 existing token + 2 candidate tokens exceeded a budget of 2, but returned a warning instead of an error. | None. |
| [M3](../mutants/tkoey/received/M3.patch): skip the unpin metadata update | R1 | Killed by the R1 property's final pin-list restoration assertion: the candidate remained pinned. | None. |

M3 leaves file bytes unchanged, so it does not violate R1's stated byte-preservation requirement. The existing property also checks that pinning then unpinning restores the initial list, which catches this separate state bug.

Normal source passed all three properties before and after testing. Each mutant produced 2 passes and 1 failure; all patches were reversed. The outgoing attack patches in `mutants/tkoey/redteam/` are unchanged.

## Submission checklist

- Push the final reviewed commit and open an individual PR to `main`; leave it unmerged.
- Obtain teammate review.
- Confirm the passing GitHub Actions `test` run logs all four properties, including the TUI package.
- Submit commit-pinned links to this file and both test files, the PR link, passing test-run link, and final commit SHA.
