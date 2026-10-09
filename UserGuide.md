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

## Plan reasoning (#3)

Plan mode explains which files or components a proposed change involves and why each one matters, before implementation begins.

### Usage

Select the Plan agent in the TUI (use `tab` to cycle agents), then describe a change you want to make. The plan should have separate `Proposed Changes` and `Reasoning` sections. Review the explanation before approving implementation.

### Trying it out

1. Open a project in opencode, select Plan, and ask: "Add input validation to the configuration loader. First explain which files you would change and why."
2. Check that `Proposed Changes` names the relevant files or components and describes the changes, while `Reasoning` explains why each is relevant.
3. Check that reviewing the plan has not changed project files. Repeat with another planning request to confirm normal planning still works.

### Automated tests

```sh
cd packages/opencode && bun test --timeout 30000 test/session/plan-prompt.test.ts
cd packages/session-ui && bun test src/components/markdown-stream.test.ts
```

| File | What it covers |
|---|---|
| `packages/opencode/test/session/plan-prompt.test.ts` | Both planning prompts request separate sections, relevant files or components, reasons for each, and no project-file edits |
| `packages/session-ui/src/components/markdown-stream.test.ts` | A sample completed planning response retains both sections and their explanations through Markdown projection |

**Why this is sufficient:** the prompt tests cover the instructions that produce the new behavior in both planning modes; the Markdown test covers preservation of the response text. The steps above verify the actual model response and read-only behavior, which prompt and projection tests alone cannot guarantee.

## Belief model (#8)

The agent often has to guess at your taste in areas the repository can't answer: how you like comments written, how you name things, whether you value efficiency over readability. The belief model turns those guesses into **beliefs** that you confirm or reject once. Confirmed beliefs are shown to the agent in every later session, and rejected ones are never proposed again.

Beliefs are for taste, not documented facts. Test commands, project structure, and environment details belong in `AGENTS.md`.

### Usage

| Action | How |
|---|---|
| Have the agent check an assumption | The agent calls the `belief` tool on its own, or you ask it to, e.g. *"Use the belief tool to check whether I prefer early returns."* |
| Confirm, reject, or defer | Answer the question that appears: **Yes, that's right**, **No**, or **Not now** |
| See the project's beliefs | Open `.opencode/beliefs.json` in the project (shared with your team; commit it) |
| See your personal beliefs | `beliefs.json` in your global opencode config directory (applies to every project) |
| Edit or remove a belief | Edit the JSON file directly; the next turn picks up the change |

- A belief's status is computed, not stored: **held** (you confirmed it), **learned** (backed by repeated corrections), **hypothesis** (only assumed by the agent), or **rejected** (you said no, and haven't confirmed it since).
- Only **held** and **learned** beliefs are shown to the agent. Hypotheses and rejected beliefs are not.
- Proposing the same statement with the same topics again updates the existing belief instead of adding a duplicate. A different statement with the same topics is kept as a separate, related belief.
- The file is pretty-printed and sorted, so a belief change shows up as a readable diff in a PR.
- If the file is malformed, opencode keeps working without it and never overwrites it. Fix the JSON and it is picked up again.
- Projects without a `beliefs.json` behave exactly as before.

### Trying it out

1. Start opencode with `bun dev <project-dir>`. (The belief tool is part of the normal `bun dev` session; you do not need any other entry point.)
2. Ask: *"Use the belief tool to check whether I prefer early returns over else branches."*
3. A **Confirm belief** question appears. Choose **Yes, that's right**.
4. Run `cat <project-dir>/.opencode/beliefs.json`. The belief is there with an `owner` assertion of `"how": "confirmed"`.
5. Start a **new** session and ask *"What beliefs have I confirmed about my code style?"* The agent lists the early-returns belief without calling any tool.
6. Ask the agent to propose a different belief and choose **No**. Then ask it to propose the same belief again. It reports that the belief was already rejected and does not ask you a second time.
7. Choose **Not now** on a third belief. It stays a hypothesis in the file and is not shown to the agent.
8. Replace the contents of `beliefs.json` with `not json` and send a message. The session still works and the file is left untouched.

### Automated tests

Run them from the package directories:

```sh
cd packages/core && bun test test/belief test/location-layer.test.ts
cd packages/opencode && bun test test/session/system.test.ts test/tool/registry.test.ts
```

| Test file | What it covers |
|---|---|
| [`packages/core/test/belief/schema.test.ts`](packages/core/test/belief/schema.test.ts) | Round-trips a belief with every field; rejects a belief with no assertion, duplicate participants, or an agent asserting with owner vocabulary; topic normalization and the store's topic vocabulary |
| [`packages/core/test/belief/status.test.ts`](packages/core/test/belief/status.test.ts) | Every status rule: owner assertion → held, rejection after assertion → rejected, re-confirming after rejection → held, corrections across two sessions → learned, a newer contradiction blocks learned, an agent-only assumption → hypothesis |
| [`packages/core/test/belief/store.test.ts`](packages/core/test/belief/store.test.ts) | Missing file loads as empty; write/read round-trip; project and personal stores are independent; sorted, pretty-printed output; malformed file reported as unavailable and never overwritten; project-config opt-out; store location outside a repository |
| [`packages/core/test/belief/propose.test.ts`](packages/core/test/belief/propose.test.ts) | Adding, merging an exact re-proposal, keeping same-topic beliefs as related, never re-adding a rejected belief, never overriding an owner assertion, no writes to a malformed file, confirm and reject |
| [`packages/core/test/belief/context.test.ts`](packages/core/test/belief/context.test.ts) | Only held and learned beliefs reach the model; later changes arrive as added/changed/removed diffs; an unreadable store keeps the previous context |
| [`packages/core/test/belief/tool.test.ts`](packages/core/test/belief/tool.test.ts) | The full propose → ask → record exchange for Yes, No, Not now, and a dismissed question; a rejected belief returns without asking; nothing is written when permission is denied |
| [`packages/opencode/test/tool/registry.test.ts`](packages/opencode/test/tool/registry.test.ts) | The `belief` tool is registered in `bun dev` sessions alongside `question` |
| [`packages/opencode/test/session/system.test.ts`](packages/opencode/test/session/system.test.ts) | The `bun dev` system prompt includes confirmed beliefs and leaves out hypotheses |

**Why this is enough:** every acceptance criterion in #8 has at least one test that fails if the behavior breaks. The tests run against the real store, schema, and context code on temporary directories, not mocks. Only the question and permission services are replaced, so the tests can answer for the owner. Both integration points are covered: the Core tool and context source, and the `bun dev` session that users actually run. The one thing the automated tests do not exercise is a live model deciding to call the tool, which is what the manual steps above are for.

## Session spending limit (#7)

Opencode can stop a session automatically once it has spent a set amount on model API usage. The limit can be set for the current session with the `/maxcost` command, or ahead of time per agent in `opencode.json` (so there is no need to hand-edit a config file to cap one session).

### Usage

| Action | How |
|---|---|
| Set a limit for this session | `/maxcost`, then enter a dollar amount such as `2.50` |
| Clear the session limit | `/maxcost`, then confirm with the field left blank |
| Set a default limit for an agent | Add `maxCost` to the agent in `opencode.json`, e.g. `{"agent": {"build": {"maxCost": 2.5}}}` |
| Continue after the limit is reached | Run `/maxcost` with a higher amount (or blank), then send another message |

- Spend is the session's running total, calculated from the tokens each model step used and the model's configured price.
- Before every step, opencode compares spend with the limit. If spend is **greater than or equal to** the limit, it makes no further model requests for that turn and posts a message saying the cost cap was reached.
- Which limit applies: the session limit from `/maxcost` if there is one, otherwise the agent's `maxCost`, otherwise no limit. A session limit overrides the config value whether it is lower or higher.
- `/maxcost` only appears inside a session. It accepts a positive number; zero, negative values and non-numbers are refused with "Enter a positive number" and nothing changes.
- The session limit is saved with the session (in its metadata), so it persists when you restart opencode and reopen the session, and is not shared with other sessions.
- The limit is re-read on every step, so a new value takes effect on the next step without restarting.
- The check runs before each step, not during one, so spend can exceed the limit by up to the cost of one step.
- A model with no configured price (for example many local models) always has $0 spend, so it never reaches a limit.
- `/maxcost` is part of the terminal UI. The `opencode.json` option works everywhere.

### Trying it out

1. Start opencode with `bun dev <project-dir>` and use `/connect` to add a provider whose models have a price. A model with no price never accrues spend, so the limit cannot trigger.
2. Start a session and run `/maxcost`. Enter `abc`, then `-1`. Each shows "Enter a positive number" and no limit is set.
3. Run `/maxcost` and enter `0.01`. A "Spending limit set to $0.01" toast appears.
4. Ask for something that takes several steps, e.g. "Read every file in src and summarize each one." After the step that takes spend to $0.01 or more, the agent stops with a message that the cost cap was reached, and no further model requests are made.
5. Send another message. It stops immediately with the same message, because spend is already over the limit.
6. Run `/maxcost`. The dialog is pre-filled with `0.01`. Enter `5`, then send another message. The agent works normally again.
7. Run `/maxcost` and confirm with the field blank. A "Spending limit cleared" toast appears and there is no limit.
8. Add `{"agent": {"build": {"maxCost": 0.01}}}` to the project's `opencode.json` and start a **new** session. Repeat step 4. It stops without any `/maxcost` command. Then run `/maxcost` and enter `5`: the session limit overrides the config value and the agent continues.
9. Set a limit with `/maxcost`, quit opencode, reopen the same session and run `/maxcost`. The dialog shows the saved value.

### Automated tests

```sh
cd packages/opencode && bun test --timeout 30000 test/session/prompt.test.ts -t "usage:|halt:|session limit:"
```

| File | What it covers |
|---|---|
| `packages/opencode/test/session/prompt.test.ts` (tests named "usage:") | A new session reports $0 spend, and session cost is the sum of the spend from each turn |
| `packages/opencode/test/session/prompt.test.ts` (tests named "halt:") | With an agent `maxCost`, the loop makes no LLM request once spend is over the limit or exactly at it, still calls the model when spend is under it, and never halts when no limit is configured |
| `packages/opencode/test/session/prompt.test.ts` (tests named "session limit:") | The `/maxcost` case with no agent limit configured, a session limit overriding a higher and a lower agent limit, clearing the limit falling back to the agent value, a non-numeric value being ignored, and a limit set mid-session halting the next turn |

**Why this is sufficient:** each acceptance criterion in #7 is checked where it can fail. The tests run the real session loop against a scripted LLM server with a priced test model, so spend is produced by the same path as in normal use: token usage is priced and added to the session total. That covers reading usage, and the "halt" tests assert on the number of requests the LLM server actually received, not on an internal flag, so they would fail if the limit check were removed or broken. The override tests exercise the exact data the `/maxcost` dialog writes (`maxCost` in session metadata), in both directions, when cleared, and when changed mid-session.
