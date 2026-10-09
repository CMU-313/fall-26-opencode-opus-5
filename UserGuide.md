# User Guide

One section per feature added by our team. Each section explains how to use the feature, how to user-test it, and where its automated tests live.

## Running opencode from source

Requires [Bun](https://bun.sh) 1.3.14 (the version pinned in `package.json`).

```sh
bun install
bun dev <project-dir>   # runs packages/opencode against <project-dir>
```

Inside the TUI, run `/connect` to add a provider (e.g. GitHub Copilot or your own API key). The OpenCode Zen free tier does not work from dev builds.

## File pinning (#4)

Files you mention with `@` are only read once, for that message, so the agent loses track of them on later turns. Pinning keeps a file in the agent's context on **every** turn, using its **current** contents, until you unpin it.

### Usage

| Action | How |
|---|---|
| Pin a file | `/pin <path>` (path relative to the project, e.g. `/pin src/index.ts`) |
| Unpin a file | `/unpin <path>` |
| See pinned files | "Pinned Files" section in the session sidebar, each marked with ◆ |
| Manage pins | `ctrl+x` then `f`, or `/pinned`, opens a list; select a file to unpin it |

- Pins belong to the session: they persist when you restart opencode and reopen the session, and are not shared with other sessions.
- Pinned files are limited to `min(50,000, 25% of the model's context window)` tokens in total. Pinning a file that would exceed the limit is refused; going above 80% shows a warning.
- Errors are shown for a missing file, a directory, a path outside the project (`../…` or absolute), and a file that is already pinned.

### Trying it out

1. Create `src/secret.ts` in your project containing `export const PINNED_SYMBOL = "blue-giraffe-42"`.
2. Start a session and run `/pin src/secret.ts`. A "Pinned src/secret.ts" toast appears and the file shows in the sidebar.
3. Ask "What is the value of PINNED_SYMBOL?" without mentioning the file. The agent answers `blue-giraffe-42` without calling the read tool.
4. Keep chatting about other things for 5+ turns, then ask again. It still knows.
5. Run `/compact`, then ask again. It still knows.
6. Edit the file to a new value and ask again. The agent sees the new value.
7. Run `/unpin src/secret.ts` (or `ctrl+x f` → select it). The sidebar entry disappears, and the agent no longer gets the file automatically.
8. Try `/pin src/nope.ts`, `/pin ../outside.ts`, pinning the same file twice, and pinning a very large file. Each shows an error instead of failing silently.

### Automated tests

```sh
cd packages/opencode && bun test test/session/pinned.test.ts test/session/prompt.test.ts -t "[Pp]inned"
cd packages/tui && bun test test/prompt/pin.test.ts
```

| File | What it covers |
|---|---|
| `packages/opencode/test/session/pinned.test.ts` | Unit tests: pin/unpin state, path normalization, deduplication, metadata merging, token limit at/under/over the boundary, and that over-limit files are marked omitted rather than silently truncated |
| `packages/opencode/test/session/prompt.test.ts` (tests named "pinned files …") | Integration tests that run the real session loop against a scripted LLM server and inspect the request actually sent to the model: content present on 5 consecutive turns without being mentioned, edits picked up and unpinning removes it, content still present after compaction, and paths outside the project never read |
| `packages/tui/test/prompt/pin.test.ts` | Parsing of `/pin` and `/unpin`, including paths with spaces, a missing path, and unrelated input |

**Why this is sufficient:** each acceptance criterion of #4 is checked at the level where it can fail. The core promise ("the model sees the file on later turns") is asserted on the actual HTTP request body sent to the model, not on internal state, so it would fail if injection, storage or compaction broke. Those integration tests also fail when the injection code is removed. The state and limit logic is pure and covered with edge cases. The TUI pieces (toasts, sidebar, keybind dialog) are thin wrappers over that logic. The repo has no TUI rendering test harness, so they were verified manually using the steps above, with screenshots in PRs #13 and #14.



## Hint Agent (#6)

OpenCode's existing agents are designed to complete programming tasks directly. The Hint Agent is designed for students who want to learn by working through problems themselves. Instead of immediately giving a complete solution, it prioritizes clarifying questions, small hints, and guidance toward the next step.

### Usage

| Action | How |
|---|---|
| Enable hint mode | Select the `hint` agent in OpenCode's agent selector |
| Get an initial hint | Ask the Hint Agent a programming question |
| Get more guidance | Ask for another hint or help with the next step |
| Request a full solution | Explicitly ask for the complete solution after working through hints |
| Return to normal behavior | Switch back to the `build` agent |

- The Hint Agent is a primary agent, just like `build` and `plan`.
- It uses the same permissions as the Build Agent, so it can still perform normal programming tasks when needed.
- Hint-specific instructions are only included when the selected agent has `hintMode` enabled. Other agents, such as `build`, are unaffected.
- The instructions encourage the agent to ask clarifying questions when necessary, provide targeted hints, and avoid immediately giving complete solutions.
- Responses are generated by a language model, so exact behavior may vary.

### Trying it out

1. Start OpenCode and select the `hint` agent.
2. Ask: "How do I reverse a linked list?"
3. Check that the agent initially explains the approach, asks a clarifying question, or gives a small hint rather than immediately writing the complete code.
4. Ask "Can you give me another hint?" and check that it provides additional guidance.
5. Ask "Can you show me the full solution now?" and check whether it provides the complete implementation.
6. Switch to the `build` agent and ask a similar programming question. The Build Agent should no longer receive the hint-specific instructions.

### Automated tests

Run from the repository root:

```sh
cd packages/opencode
bun test test/agent/agent.test.ts test/session/system.test.ts
bun test --timeout 30000 test/session/prompt.test.ts -t "hint-mode"
```

| File | What it covers |
|---|---|
| `packages/opencode/test/agent/agent.test.ts` | Verifies that the Hint Agent is registered as a primary native agent, has `hintMode` enabled, and retains the expected permissions |
| `packages/opencode/test/session/system.test.ts` | Verifies that hint-mode instructions are generated when `hintMode` is enabled and are omitted when it is disabled |
| `packages/opencode/test/session/prompt.test.ts` (tests named "hint-mode") | Integration tests that run the session loop against a scripted LLM server and inspect the actual model request. They verify that hint instructions are included for the Hint Agent and omitted for the Build Agent |

**Why this is sufficient:** the tests cover the main acceptance criteria of #6 at multiple levels. The agent tests verify that the Hint Agent is registered and configured correctly. The system prompt tests verify that hint instructions are generated only when hint mode is enabled. Most importantly, the integration tests inspect the actual request sent to the model, rather than only checking internal configuration. This confirms that the hint instructions reach the LLM and that existing agents are not affected. The tests would fail if the hint instructions were no longer included in the model request. Since language model responses are nondeterministic, automated tests cannot guarantee that every response will follow the instructions exactly. The manual testing steps above provide an additional check of the intended learning behavior.
