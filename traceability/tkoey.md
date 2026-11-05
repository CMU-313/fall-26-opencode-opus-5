# Traceability: Takeshi Koey (tkoey)

**Target feature:** File pinning through `/pin` and `/unpin`.

Main source files:

- [Pin commands and validation](../packages/tui/src/component/prompt/pin.ts)
- [Pinned-file state, path normalization, and token limits](../packages/core/src/util/pinned.ts)
- [Loading and formatting pinned-file contents](../packages/opencode/src/session/pinned.ts)
- [Pinned-file dialog](../packages/tui/src/component/dialog-pinned-files.tsx) and [sidebar](../packages/tui/src/feature-plugins/sidebar/pinned.tsx)

## Requirements

The interview evidence, requirement wording, and acceptance criteria below are copied from my submitted P3 workbook.

| ID  | Interview evidence                                                                                                              | Requirement                                                                                                                                                                                 | Acceptance Criteria                                                                                                                                                                                                               | Changed in P4? | Property (kind)                                                                                                                                                                            | Test                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| R1  | S-1, S-3: Pinning and unpinning should not change file contents.                                                                | /pin and /unpin must preserve file contents.                                                                                                                                                | Record a.txt's contents, pin it, then unpin it. After each command, its contents match the original exactly.                                                                                                                      | No             | File bytes remain identical after each command, including other pinned files; the additional pin/unpin sequence restores the initial pin list (invariant).                                 | [R1: pin and unpin preserve file bytes after each command](../packages/tui/test/prompt/pin.property.test.ts)                        |
| R2  | C-5: Showing the project-relative path helps distinguish files with the same filename.                                          | The pinned-file list must identify each pinned file by its project-relative path so files with identical filenames can be distinguished.                                                    | Pin src/client/config.ts and src/server/config.ts. Open the pinned-file list. Both entries display their respective project-relative paths, rather than displaying only config.ts.                                                | No             | Not selected for the minimum four properties.                                                                                                                                              | —                                                                                                                                   |
| R3  | S-2: The same set of pinned files should have a consistent displayed order.                                                     | The displayed order must be independent of the order files were pinned.                                                                                                                     | Pin A then B in one session and B then A in another. Both pinned-file lists display the same ordering.                                                                                                                            | No             | Shuffling or reversing pin insertion order leaves the displayed list identical and preserves every path, without changing metadata (metamorphic).                                          | [R3: displayed pin order is independent of insertion order](../packages/tui/test/prompt/pin.property.test.ts)                       |
| R4  | S-4: A file appearing pinned is insufficient; its contents must actually reach the model.                                       | Successfully pinned, readable files whose combined estimated size fits within the pinning budget must have their contents included in the next model request.                               | Pin a readable file containing DEMO_CODE = blue-giraffe-42, with total pinned content below the pinning budget. Send a message. The actual model request includes that line.                                                      | No             | A map of real readable file contents is the oracle for the complete pinned-file blocks in the actual captured HTTP model request (model/oracle).                                           | [R4: eligible pinned file contents reach the actual model request (property)](../packages/opencode/test/session/prompt.test.ts)     |
| R5  | S-5: Files exceeding available context capacity should produce an error.                                                        | When a pin command would make total pinned content exceed the pinning budget, the tool must reject the new pin, display an error, and preserve existing pins.                               | With a pinning budget of 1,000 tokens and A already using 600 tokens, attempt to pin B estimated at 401 tokens. A visible command error explains that the pinning budget would be exceeded. B is not added, and A remains pinned. | No             | A command exceeding the budget returns an explanatory error and performs no metadata update. Valid commands below or exactly at the budget succeed and preserve existing pins (invariant). | [R5: command accepts within budget and rejects over budget without changing pins](../packages/tui/test/prompt/pin.property.test.ts) |
| R6  | O-3: Users need to understand whether unpinning removes previously shared information or only stops future automatic inclusion. | After successfully unpinning a file, the tool must display a confirmation explaining that automatic inclusion has stopped and information already discussed may remain in the conversation. | With notes.txt pinned, run /unpin notes.txt. The visible confirmation identifies notes.txt and states: “Automatic inclusion stopped. Information already discussed may remain in this conversation.”                              | No             | Not selected for the minimum four properties. Current confirmation is only `Unpinned <path>`; R6 is retained but not implemented by this P4 change.                                        | —                                                                                                                                   |

Properties written or suggested by opencode or another AI tool: R1, R3, R4, and R5 were suggested and implemented with ChatGPT/Codex assistance, including generators and the R3 display fix. Earlier AI suggestions also discussed R2 and R6; neither has a dedicated property in this submission. I am responsible for reviewing the properties and their relationship to the interview evidence.

## Requirement changes

All six requirements are retained because they describe feasible, checkable behavior and do not conflict with each other. R4 is tested for inclusion in the next request; this submission does not add an edited-file refresh guarantee or a path-normalization requirement to the P3 wording.

| ID  | Original requirement (P3) | Revised requirement | Why it changed           |
| --- | ------------------------- | ------------------- | ------------------------ |
| —   | —                         | —                   | No requirements changed. |

## Generators and test boundaries

- R1 generates distinct valid nested paths (including spaces and identical basenames), empty/nonempty text, Unicode, and multiline text. The candidate starts unpinned and other files start pinned. Real temporary files are compared byte-for-byte after each actual command.
- R3 generates 2–6 distinct paths, full permutations, and reversed insertion orders. Both pinned-file UI surfaces use the same tested presentation function. The property checks that sorting does not mutate metadata or drop paths; stored pin order and model-context order remain unchanged.
- R4 generates 1–4 readable files with empty, Unicode, multiline, or generated contents, with each content capped at 200 characters. This is well under the configured model's 25,000-token pinning budget. The existing session/prompt fixture sends a real HTTP request to a local test provider; the property compares complete file blocks with that request. It starts with valid pinned session metadata, so pin admission itself is covered separately by command properties.
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
bun test test/prompt/pin.property.test.ts --timeout 30000
bun typecheck
```

```sh
cd packages/opencode
bun test test/session/prompt.test.ts --test-name-pattern '^R4:' --timeout 60000
bun typecheck
```

## Submission checklist

- Push the final reviewed commit and open an individual PR to `main`; leave it unmerged.
- Obtain teammate review.
- Confirm the passing GitHub Actions `test` run logs all four properties, including the TUI package.
- Submit commit-pinned links to this file and both test files, the PR link, passing test-run link, and final commit SHA.
