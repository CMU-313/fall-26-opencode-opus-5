import { expect, test } from "bun:test"
import fc from "fast-check"
import path from "node:path"
import os from "node:os"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { createOpencodeClient, type Session } from "@opencode-ai/sdk/v2/client"
import { Pinned } from "@opencode-ai/core/util/pinned"
import { runPinCommand } from "../../src/component/prompt/pin"
import { pinnedPaths } from "../../src/util/pinned"

// Valid relative paths include nested directories, spaces, and identical basenames.
const paths = fc.uniqueArray(
  fc
    .tuple(fc.integer({ min: 0, max: 30 }), fc.constantFrom("config.ts", "my notes.txt", "empty.txt"))
    .map(([directory, name]) => `src/${directory}/${name}`),
  { minLength: 2, maxLength: 6 },
)

// R1: /pin and /unpin must preserve file contents.
// Kind: invariant. Empty, Unicode, and multiline contents are checked after EACH command.
test("R1: pin and unpin preserve file bytes after each command", async () => {
  await fc.assert(
    fc.asyncProperty(
      paths,
      fc.oneof(fc.string({ maxLength: 300 }), fc.constant("日本語\nline two\n")),
      async (files, content) => {
        await using fixture = await project(files, content)
        const before = await Promise.all(
          files.map((file) => Bun.file(path.join(fixture.session.directory, file)).bytes()),
        )
        const candidate = files[0]
        const initial = Pinned.list(fixture.session.metadata)
        for (const action of ["pin", "unpin"] as const) {
          const result = await runPinCommand({
            client: fixture.client,
            session: fixture.session,
            command: { action, path: candidate },
          })
          expect(result.type).not.toBe("error")
          expect(
            await Promise.all(files.map((file) => Bun.file(path.join(fixture.session.directory, file)).bytes())),
          ).toEqual(before)
        }
        expect(Pinned.list(fixture.session.metadata)).toEqual(initial)
        expect(fixture.session.metadata?.other).toBe("preserved")
      },
    ),
    { numRuns: 100, examples: [[["src/client/config.ts", "src/server/config.ts"], ""]] },
  )
})

// R3: The displayed order must be independent of the order files were pinned.
// Kind: metamorphic. Shuffle a complete set, including same-basename paths, and
// also reverse it so every nontrivial generated set exercises a changed order.
test("R3: displayed pin order is independent of insertion order", () => {
  fc.assert(
    fc.property(
      paths.chain((files) =>
        fc.tuple(
          fc.constant(files),
          fc.shuffledSubarray(files, {
            minLength: files.length,
            maxLength: files.length,
          }),
        ),
      ),
      ([files, shuffled]) => {
        const metadata = { pinnedFiles: files, other: "preserved" }
        expect(pinnedPaths({ pinnedFiles: shuffled })).toEqual(pinnedPaths(metadata))
        expect(pinnedPaths({ pinnedFiles: files.toReversed() })).toEqual(pinnedPaths(metadata))
        expect(pinnedPaths(metadata).toSorted()).toEqual(files.toSorted())
        expect(metadata.pinnedFiles).toEqual(files)
      },
    ),
    { numRuns: 200 },
  )
})

// R5: When a pin command would make total pinned content exceed the pinning
// budget, reject the new pin, display an error, and preserve existing pins.
// Kind: invariant. Four ASCII characters estimate to one token; exercise totals
// one below, exactly at, and one above every generated budget, including tiny budgets.
test("R5: command accepts within budget and rejects over budget without changing pins", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 2, max: 2000 }), fc.nat({ max: 2000 }), async (budget, seed) => {
      const existing = seed % budget
      for (const delta of [-1, 0, 1]) {
        await using fixture = await project(["candidate.txt", "existing.txt"], "")
        await Bun.write(path.join(fixture.session.directory, "existing.txt"), "a".repeat(existing * 4))
        await Bun.write(
          path.join(fixture.session.directory, "candidate.txt"),
          "b".repeat((budget - existing + delta) * 4),
        )
        const before = structuredClone(fixture.session.metadata)
        const result = await runPinCommand({
          client: fixture.client,
          session: fixture.session,
          command: { action: "pin", path: "candidate.txt" },
          model: { limit: { context: budget * 4 } },
        })
        if (delta > 0) {
          expect(result.type).toBe("error")
          expect(result.message).toContain("token limit")
          expect(fixture.session.metadata).toEqual(before)
          expect(fixture.updates).toHaveLength(0)
          continue
        }
        expect(result.type).not.toBe("error")
        expect(Pinned.list(fixture.session.metadata)).toEqual(["existing.txt", "candidate.txt"])
        expect(fixture.updates).toHaveLength(1)
      }
    }),
    { numRuns: 100, examples: [[1000, 600]] },
  )
})

// A narrow SDK transport fixture uses real temporary files and records metadata
// writes. Unexpected requests fail; no global mocks or production servers are used.
async function project(files: string[], content: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tkoey-pin-property-"))
  await Promise.all(
    files.map((file, index) =>
      Bun.write(path.join(directory, file), index === 0 ? content : `existing:${index}\n${content}`),
    ),
  )
  const session: Session = {
    id: "ses_property",
    slug: "property",
    projectID: "project",
    directory,
    title: "Property test",
    version: "1",
    time: { created: 0, updated: 0 },
    metadata: { pinnedFiles: files.slice(1), other: "preserved" },
  }
  const updates: unknown[] = []
  const client = createOpencodeClient({
    baseUrl: "http://pin-test.invalid",
    fetch: Object.assign(
      async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input)
        const url = new URL(request.url)
        if (request.method === "GET" && url.pathname === "/file") {
          const relative = url.searchParams.get("path") ?? ""
          return Response.json(
            (await readdir(path.join(directory, relative), { withFileTypes: true })).map((entry) => ({
              name: entry.name,
              path: path.posix.join(relative, entry.name),
              absolute: path.join(directory, relative, entry.name),
              type: entry.isFile() ? "file" : "directory",
              ignored: false,
            })),
          )
        }
        if (request.method === "GET" && url.pathname === "/file/content") {
          return Response.json({
            type: "text",
            content: await Bun.file(path.join(directory, url.searchParams.get("path")!)).text(),
          })
        }
        if (request.method === "PATCH" && url.pathname === `/session/${session.id}`) {
          const body: Pick<Session, "metadata"> = await request.json()
          updates.push(body)
          session.metadata = body.metadata
          return Response.json(session)
        }
        throw new Error(`Unexpected pin request: ${request.method} ${url.pathname}`)
      },
      { preconnect() {} },
    ),
  })
  return { client, session, updates, [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
}
