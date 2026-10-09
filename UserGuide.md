# User Guide

One section per feature added by our team. Each section explains how to use the feature, how to user-test it, and where its automated tests live.

## Running opencode from source

Requires [Bun](https://bun.sh) 1.3.14 (the version pinned in `package.json`).

```sh
bun install
bun dev <project-dir>   # runs packages/opencode against <project-dir>
```

Inside the TUI, run `/connect` to add a provider (e.g. GitHub Copilot or your own API key). The OpenCode Zen free tier does not work from dev builds.

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
