# Traceability: Parishi Jain (parishij)

**Target feature:** File Pinning

Main implementation files:
- `packages/core/src/util/pinned.ts`
- `packages/opencode/src/session/pinned.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/tui/src/component/dialog-pinned-files.tsx`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | C-2, C-3, S-3, O-2, O-3 | Once a user pins a file, it should stay pinned and be included in future prompts until the user unpins it. | Pin a file and send three unrelated prompts. The file remains pinned and its contents are included each time. | No | Invariant: pinned state and rendered content persist across repeated turns. | `packages/opencode/test/session/pinned.parishij.property.test.ts` |
| R2 | C-4, S-4, O-4 | When a user unpins a file, it should disappear from the pinned list and stop being automatically included in new prompts. | Pin and then unpin a file. Verify the pinned list no longer contains it and its content is not automatically included in the next request. | No | Round-trip: adding and then removing a file restores the original pinned list. | `packages/opencode/test/session/pinned.parishij.property.test.ts` |
| R3 | C-5, S-6, O-5 | If a user edits a pinned file, the agent should receive the updated version on the next turn while keeping the file pinned. | Pin a file containing `value = 10`, edit it to `value = 20`, and verify the next request includes the updated content without removing the pin. | No | Not implemented as a P4 property; requires a filesystem-backed test. | — |
| R4 | C-8, S-8, O-8 | Pinned files should only apply to the session they were pinned in, not other sessions. | Pin a file in session A and create session B. Verify the file appears only in A's pinned list and is not automatically included in B's requests. | No | Not implemented as a P4 property; requires session isolation testing. | — |
| R5 | C-9, S-9, O-9 | The system should show an error when a user tries to pin a file that does not exist, is outside the project, or is already pinned. | Try pinning nonexistent, outside-project, and duplicate files. Verify each produces an error or clear message and does not create an invalid or duplicate entry. | Yes | Invariant: adding the same normalized path twice never creates duplicate entries. | `packages/opencode/test/session/pinned.parishij.property.test.ts` |
| R6 | C-10, S-10, O-10 | If pinned file contents exceed the allowed context budget, the system should warn the user and avoid including incomplete file contents. | Generate files whose combined token counts exceed the budget. Verify oversized contents are omitted completely with a clear explanation rather than silently truncated. | Yes | Not implemented as a P4 property; existing example tests check omission behavior. | `packages/opencode/test/session/pinned.test.ts` |
| R7 | S-2, O-2 | Pinning or unpinning a file should not change, rename, or delete the file itself. | Record a file's name, path, and contents, pin and unpin it, and verify these remain unchanged. | No | Not implemented as a P4 property; requires a filesystem-backed test. | — |
| R8 | C-6, C-7, S-7, O-6, O-7 | The file pinning feature should include the pinned file's contents in requests sent to the model, even when the user does not mention the file. | Pin a file, send unrelated prompts, and verify its complete contents are included in each request. | No | Metamorphic: adding another file within the budget preserves the original file's rendered content. | `packages/opencode/test/session/pinned.parishij.property.test.ts` |

Properties written or suggested by opencode or another AI tool: R1, R2, R5, and R8 were suggested and drafted with assistance from ChatGPT, then reviewed and tested locally.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R5 | The system should show an error when a user tries to pin a file that does not exist, is outside the project, or is already pinned. | The system should prevent invalid paths and duplicate entries from being added to the pinned list, and provide clear feedback when a pin request cannot be completed. | The original requirement specifically demanded an error for duplicates, but duplicate pin requests can also be handled safely without changing the pinned list. The important behavior is that users do not end up with duplicate or invalid entries. |
| R6 | If a file would make the pinned contents exceed the context limit, the system should warn the user and avoid pinning incomplete file contents. | If pinned file contents exceed the allowed context budget, the system should warn the user and avoid including incomplete file contents. | The existing implementation can omit oversized content from the rendered context rather than always rejecting the pin. This revision focuses on preventing incomplete content from being sent to the model and making the omission clear to the user. |

The other six requirements were retained because they describe distinct, observable user behaviors. Their acceptance criteria can be checked through session metadata, file contents, or the constructed model request.

## P5 Mutation Testing

### Hand-written mutants

Five hand-written mutants were tested against the property-based tests. All five were killed.

| Mutant | Change | Result | Detecting property |
|---|---|---|---|
| H1 | Removed the duplicate-pin guard | Killed | R5 |
| H2 | Made unpinning leave the pinned list unchanged | Killed | R2 |
| H3 | Removed pinned-file metadata from the session | Killed | R1 |
| H4 | Removed pinned-file contents from rendered context | Killed | R1, R8 |
| H5 | Rendered only the first pinned file | Killed | R8 |

H5 initially survived. I strengthened R8 to check that both the original pinned file and the newly added file appear in the rendered context. After this change, H5 was killed.

### Stryker mutation testing

Stryker was run against `packages/opencode/src/session/pinned.ts`, using `pinned.parishij.property.test.ts`.

| Metric | Result |
|---|---|
| Generated mutants | 32 |
| Killed | 7 |
| Survived | 25 |
| Timed out | 0 |
| Mutation score | 21.88% |

Reports:
- `mutants/parishij/mutation.html`
- `mutants/parishij/mutation.json`

The surviving mutants exposed gaps in the current properties, particularly around missing-file handling, token-budget boundaries, path validation, and filesystem loading. The properties primarily exercise normal pinning, unpinning, persistence, and rendering behavior.

### Comparison

The hand-written mutants targeted specific behaviors described by the requirements, so all five were detected. Stryker generated a broader range of mutations, including changes to branches and error-handling logic that the current properties do not exercise.

This shows that killing targeted mutants does not guarantee comprehensive test coverage. Additional properties should exercise missing files, invalid paths, token-budget boundaries, and file-loading behavior.
