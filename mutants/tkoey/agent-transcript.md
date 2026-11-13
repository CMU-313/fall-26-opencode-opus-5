# Fast-check property for R4 pinned file inclusion

**Session ID:** ses_e2d1199d9ffe1LEHHqjhT9a7S0
**Created:** 11/13/2026, 3:23:21 AM
**Updated:** 11/13/2026, 3:28:00 AM

---

## User

Write a fast-check property for R4: successfully pinned, readable files whose combined estimated size fits within the pinning budget must have their contents included in the next model request. Use the existing HTTP provider fixture in packages/opencode/test/session/prompt.test.ts. Suggest the property code and explain its generator and assertions. Do not edit files yet. 

---

## Assistant (Build · Claude Sonnet 4.6 · 215.4s)

**Tool: task**

---

## Assistant (Build · Claude Sonnet 4.6 · 5.5s)

Now let me read the actual current state of the prompt.test.ts file around the pinned file tests section to see exactly what's there:

**Tool: read**

**Tool: read**

---

## Assistant (Build · Claude Sonnet 4.6 · 8.0s)

Now I have a complete picture. The property test already exists at lines 2796–2840. Let me also look at the Token estimator and the pinned.property.test.ts for context on the existing style:

**Tool: read**

**Tool: read**

---

## Assistant (Build · Claude Sonnet 4.6 · 50.1s)

I now have everything needed. The property test at lines 2796–2840 of `prompt.test.ts` already exists. Here is my complete analysis and suggested property code with detailed explanation:

---

## The Property Already Exists

The R4 HTTP-integration property is already written at **`prompt.test.ts:2796–2840`**. It is exactly what you described. Here's the code reproduced cleanly, followed by a full explanation of every design choice:

---

```ts
// R4: Successfully pinned, readable files whose combined estimated size fits
// within the pinning budget must have their contents included in the next model request.
// Kind: model/oracle. A map of real file contents is the oracle, compared with
// the captured HTTP provider request. Nested same-basename paths and empty,
// Unicode, and multiline contents are mixed with pairs totaling exactly 25,000 tokens.
it.instance(
  "R4: eligible pinned file contents reach the actual model request (property)",
  () =>
    Effect.gen(function* () {
      const config = yield* useServerConfig(providerCfg)
      const context = yield* Effect.context<
        FSUtil.Service | Session.Service | SessionPrompt.Service | TestLLMServer
      >()
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(
            fc.oneof(
              // Branch A: 1–4 arbitrary strings (empty, Unicode, multiline, plain ASCII)
              fc.array(
                fc.oneof(
                  fc.string({ maxLength: 200 }),
                  fc.constant(""),
                  fc.constant("日本語\nline two\n"),
                ),
                { minLength: 1, maxLength: 4 },
              ),
              // Branch B: two files totalling exactly 25,000 estimated tokens
              //           (the fixture's 25% of 100,000 context tokens)
              fc.integer({ min: 1, max: 24_999 }),
            ),
            (input) =>
              Effect.runPromiseWith(context)(
                Effect.gen(function* () {
                  // Materialise Branch B into two content strings
                  const contents =
                    typeof input === "number"
                      ? ["a".repeat(input * 4), "b".repeat((25_000 - input) * 4)]
                      : input

                  // Give every file a distinct, nested path so the oracle can
                  // distinguish them even when two files share the same basename
                  const files = contents.map((content, index) => ({
                    path: `property/${index}/config.txt`,
                    content,
                  }))

                  // Write real files to the fixture's tmpdir so `SessionPinned.load`
                  // can read them through FSUtil
                  yield* Effect.forEach(files, (file) =>
                    writeText(path.join(config.dir, file.path), file.content),
                  )

                  // Create a fresh session that pins exactly those files
                  const sessions = yield* Session.Service
                  const chat = yield* sessions.create({
                    title: "R4 property",
                    metadata: { pinnedFiles: files.map((f) => f.path) },
                  })

                  // Drive one full prompt → loop cycle; capture what the HTTP
                  // provider actually received
                  const body = yield* pinnedTurn(chat.id, "Inspect the pinned files.")

                  // Oracle assertion: every file's content must appear verbatim
                  // inside the JSON-serialised request body
                  files.forEach((file) => {
                    const block = `<pinned-file path="${file.path}">\n${file.content}\n</pinned-file>`
                    expect(body.includes(JSON.stringify(block).slice(1, -1))).toBe(true)
                  })
                }),
              ),
          ),
          {
            seed: 42,
            numRuns: 100,
            // A concrete example that doubles as documentation
            examples: [[["DEMO_CODE = blue-giraffe-42"]]],
          },
        ),
      )
    }),
  60_000,
)
```

---

## Generator Design

### Two-branch `fc.oneof`

**Branch A — arbitrary content array**
```ts
fc.array(
  fc.oneof(
    fc.string({ maxLength: 200 }),  // printable ASCII & surrogate chars
    fc.constant(""),                // empty file (zero tokens)
    fc.constant("日本語\nline two\n"), // multi-byte Unicode with real newlines
  ),
  { minLength: 1, maxLength: 4 },
)
```
This covers the cases the codebase already worries about: empty files, Unicode that the token estimator must handle correctly, and multi-line content where the XML serialisation needs embedded newlines to stay intact.

**Branch B — exact boundary pairs**
```ts
fc.integer({ min: 1, max: 24_999 })
// → ["a".repeat(n*4), "b".repeat((25_000-n)*4)]
```
The fixture model has `context: 100_000` tokens, and `SessionPinned.limit` takes `CONTEXT_SHARE = 0.25`, so the budget is exactly 25,000 tokens. The factor of 4 comes from `Token.estimate`'s approximation (4 bytes ≈ 1 token for ASCII). Every split between 1 and 24,999 produces a combined total that fits within the budget — this is the core budget-boundary coverage. The two content strings are distinguishable (`"a"` vs `"b"`) so a swap or omission would fail the assertion.

**Why `fc.oneof` between the two branches?** It prevents the shrinking of a failing integer case from accidentally shrinking into an array case; `fc.oneof` keeps the two populations separate during shrinking.

### Nested paths: `property/${index}/config.txt`

Using index-namespaced subdirectories means two files can share the filename `config.txt` without conflicting on disk and without the oracle accidentally matching one file's content against another's path.

### Context capture: `Effect.context<...>()`

```ts
const context = yield* Effect.context<FSUtil.Service | Session.Service | ...>()
// later:
Effect.runPromiseWith(context)(...)
```
Fast-check's `asyncProperty` runs outside the Effect runtime, but each run needs access to the same layer (tmpdir, test LLM server, session DB). Capturing the ambient context once and re-providing it per run avoids spinning up a new layer per check while keeping runs isolated at the _session_ level (each run creates a fresh session).

---

## Assertion Design

```ts
const block = `<pinned-file path="${file.path}">\n${file.content}\n</pinned-file>`
expect(body.includes(JSON.stringify(block).slice(1, -1))).toBe(true)
```

`body` is `JSON.stringify(hits.at(-1)?.body)` — the full JSON of the request body the test LLM server received. The `.slice(1, -1)` strips the outer double-quotes that `JSON.stringify` adds to the XML string, leaving the JSON-escaped interior. This correctly handles embedded newlines (they become `\n` in JSON), embedded quotes, and Unicode escape sequences.

**What this assertion proves end-to-end:**

1. `SessionPinned.load` read the file from disk.
2. `SessionPinned.render` formatted it inside a `<pinned-file>` block.
3. `SessionReminders.apply` appended the synthetic text part to the outgoing message.
4. `SessionPrompt.loop` serialised the message and sent it to the provider endpoint.
5. `TestLLMServer` captured the HTTP body verbatim — no truncation, no double-encoding.

**What it does _not_ assert** (by design): it does not assert that files _over_ the budget are omitted — that is covered by the pure `render` property in `pinned.property.test.ts:75–107`. Keeping the HTTP test focused on the happy-path inclusion prevents it from being a duplicate of the pure render test.

---

## Relationship to the Existing Test Suite

| File | Coverage |
|---|---|
| `pinned.property.test.ts:75` | `render()` budget logic, pure, no I/O |
| `pinned.property.test.ts:113` | `load()` with deleted/renamed files, real tmpdir |
| `prompt.test.ts:2842` | Injection persists across multiple turns (concrete) |
| **`prompt.test.ts:2796`** | **R4: eligible contents reach the HTTP request (property)** |

The property at 2796 is the only one that closes the loop from pinned metadata all the way to the wire — it is the right place, it uses the right fixture (`it.instance` + `useServerConfig` + `TestLLMServer`), and it is already present in the file.

---

