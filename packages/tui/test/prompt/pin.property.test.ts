import { describe, expect, test } from "bun:test"
import path from "path"
import fc from "fast-check"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"
import * as Pin from "../../src/component/prompt/pin"

// Fixed seed so mutation runs (Stryker, hand-written mutants) are reproducible.
fc.configureGlobal({ seed: 17313 })

type FakeFile = { content: string; ignored: boolean; binary?: boolean }

// A fake SDK client backed by an in-memory project. file.list returns the direct children of a
// directory the way the server does (files plus the directories that contain them) and an error for
// a directory that doesn't exist. file.read returns contents (binary files as type "binary"), and
// session.update records the metadata it was given, or fails when `fail` is set.
function fake(project: Record<string, FakeFile>, options: { fail?: boolean } = {}) {
  const updates: Record<string, unknown>[] = []
  const client = {
    file: {
      list: async ({ path: dir }: { path: string }) => {
        const prefix = dir ? dir + "/" : ""
        const names = new Map<string, "file" | "directory">()
        for (const file of Object.keys(project)) {
          if (!file.startsWith(prefix)) continue
          const [head, ...rest] = file.slice(prefix.length).split("/")
          names.set(head, rest.length === 0 ? "file" : "directory")
        }
        if (dir && names.size === 0) return { error: { name: "NotFoundError" }, data: undefined }
        const data = [...names].map(([name, type]) => ({
          name,
          type,
          path: prefix + name,
          absolute: "/project/" + prefix + name,
          ignored: project[prefix + name]?.ignored ?? false,
        }))
        return { data }
      },
      read: async ({ path: file }: { path: string }) => ({
        data: project[file]
          ? { type: project[file].binary ? "binary" : "text", content: project[file].content }
          : undefined,
      }),
    },
    session: {
      update: async ({ metadata }: { metadata: Record<string, unknown> }) => {
        updates.push(metadata)
        return options.fail ? { error: { name: "UnknownError" } } : { data: {} }
      },
    },
  }
  return { client: client as unknown as OpencodeClient, updates }
}

const session = (files: string[]) => ({ id: "ses_test", metadata: { pinnedFiles: files } }) as unknown as Session

// Generators. Interviewees worried about dotfiles (.env, .gitignore), unusual extensions and
// nested paths, so names mix plain files, dotfiles and multi-dot extensions under 0-3 directories.
const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/)
const dotfile = fc.constantFrom(".env", ".gitignore", ".npmrc", ".env.local", ".prettierrc")
const ext = fc.constantFrom("", ".ts", ".md", ".json", ".min.js", ".lock", ".tar.gz", ".PY")
const name = fc.oneof(
  fc.tuple(segment, ext).map(([base, e]) => base + e),
  dotfile,
)
const filePath = fc.tuple(fc.array(segment, { maxLength: 3 }), name).map(([dirs, file]) => [...dirs, file].join("/"))
// Paths where no path is a directory of another, so all of them can exist as files at once.
const noNesting = (files: string[]) => files.every((a) => files.every((b) => !b.startsWith(a + "/")))
const pinSet = fc.uniqueArray(filePath, { minLength: 1, maxLength: 5 }).filter(noNesting)
// How a user may type a path that means the same file: as is, with "./", or with "@" (autocomplete).
const spelling = fc.constantFrom("", "./", "@")

describe("pin command properties", () => {
  // R1: Any existing file in the project can be pinned, regardless of extension or read-only status.
  // Kind: model/oracle. An existing, unpinned file (however it is spelled) is appended to the pinned
  // set. Everything else (empty, outside the project, already pinned, missing, a directory, failed
  // save) is an
  // error that names the path and leaves the pinned set as it was.
  test("R1: existing files can be pinned and other paths are rejected", async () => {
    const kind = fc.constantFrom("new", "empty", "outside", "absolute", "pinned", "missing", "directory")
    await fc.assert(
      fc.asyncProperty(pinSet, kind, spelling, fc.boolean(), async (files, kind, prefix, fail) => {
        const [file, ...current] = files
        if (kind === "pinned") fc.pre(current.length > 0)
        if (kind === "directory") fc.pre(file.includes("/"))
        const project = Object.fromEntries(files.map((item) => [item, { content: "", ignored: false }]))
        const { client, updates } = fake(project, { fail })
        const target = {
          new: file,
          empty: "",
          outside: "../" + file,
          absolute: "/" + file,
          pinned: current[0],
          missing: path.posix.join(path.posix.dirname(file), "missing-" + path.posix.basename(file)),
          directory: path.posix.dirname(file),
        }[kind]
        const typed = kind === "outside" || kind === "absolute" || kind === "empty" ? target : prefix + target
        const result = await Pin.runPinCommand({
          client,
          session: session(current),
          command: { action: "pin", path: typed },
        })
        const expected = {
          empty: "Usage: /pin <path>",
          outside: `${target} is outside the project`,
          absolute: `${target} is outside the project`,
          pinned: `${target} is already pinned`,
          missing: `${target} is not a file in this project`,
          directory: `${target} is not a file in this project`,
          new: fail ? `Failed to pin ${target}` : undefined,
        }[kind]
        if (expected) {
          expect(result).toEqual({ type: "error", message: expected })
          if (kind !== "new") expect(updates).toEqual([])
          return
        }
        expect(result).toEqual({ type: "success", message: `Pinned ${file}`, files: [...current, file] })
        expect(updates).toEqual([{ pinnedFiles: [...current, file] }])
      }),
    )
  })

  // R2: Pinning a file that matches .gitignore succeeds but shows a warning.
  // Kind: model/oracle. The pin is refused only when all pinned text would go over the model's token
  // limit. Otherwise it is a warning iff the file is gitignored or pinned text is over 80% of the
  // limit, and the message lists exactly those warnings. Binary files, and earlier pins that no
  // longer exist (R4), count as 0 tokens.
  test("R2: gitignored files are pinned with a warning, others without", async () => {
    // Contents are "x" repeated 4*t times, which is exactly t tokens.
    const entry = fc.record({ tokens: fc.integer({ min: 0, max: 10 }), binary: fc.boolean(), gone: fc.boolean() })
    await fc.assert(
      fc.asyncProperty(
        pinSet,
        fc.array(entry, { minLength: 5, maxLength: 5 }),
        fc.boolean(),
        fc.option(fc.integer({ min: 1, max: 30 })),
        async (files, entries, ignored, limit) => {
          const [file, ...current] = files
          // Index 0 is the file being pinned, so it always exists.
          const exists = (i: number) => i === 0 || !entries[i].gone
          const project: Record<string, FakeFile> = {}
          for (const [i, item] of files.entries()) {
            if (!exists(i)) continue
            project[item] = { content: "x".repeat(4 * entries[i].tokens), binary: entries[i].binary, ignored: i === 0 && ignored }
          }
          const { client, updates } = fake(project)
          // A context of 4*limit gives a pinned-file limit of exactly `limit` (25% of the context).
          const model = limit === null ? undefined : { limit: { context: 4 * limit } }
          const result = await Pin.runPinCommand({
            client,
            session: session(current),
            command: { action: "pin", path: file },
            model,
          })
          const max = limit ?? 50_000
          const counted = (i: number) => exists(i) && !entries[i].binary
          const used = files.reduce((sum, _, i) => sum + (counted(i) ? entries[i].tokens : 0), 0)
          if (used > max) {
            expect(result).toEqual({
              type: "error",
              message: `Not pinned: pinned files would use ~${used.toLocaleString()} tokens, over the ${max.toLocaleString()} token limit for this model`,
            })
            expect(updates).toEqual([])
            return
          }
          const warnings = [
            ...(ignored ? [`${file} matches .gitignore`] : []),
            ...(used > max * 0.8 ? [`Pinned files use ~${used.toLocaleString()} of ${max.toLocaleString()} tokens`] : []),
          ]
          expect(result).toEqual({
            type: warnings.length > 0 ? "warning" : "success",
            message: [`Pinned ${file}`, ...warnings].join(". "),
            files: [...current, file],
          })
          expect(result.message.includes("matches .gitignore")).toBe(ignored)
          // The pin is saved whether or not it warns.
          expect(updates).toEqual([{ pinnedFiles: [...current, file] }])
        },
      ),
    )
  })

  // R4: If a pinned file is deleted or renamed, the next message shows a "file not found" error for
  // that path, still sends with the remaining pins, and does not move the pin to the new path.
  // Kind: model/oracle (the reported paths are exactly the pins whose fate is delete or rename).
  // This covers the user-facing error; what is sent to the model is checked in
  // packages/opencode/test/session/pinned.property.test.ts.
  test("R4: deleted or renamed pins are reported to the user by path", async () => {
    const fate = fc.constantFrom("keep", "delete", "rename")
    await fc.assert(
      fc.asyncProperty(
        pinSet.chain((files) =>
          fc.tuple(fc.constant(files), fc.array(fate, { minLength: files.length, maxLength: files.length })),
        ),
        async ([files, fates]) => {
          const project: Record<string, FakeFile> = {}
          for (const [i, file] of files.entries()) {
            if (fates[i] === "keep") project[file] = { content: "", ignored: false }
            if (fates[i] === "rename")
              project[path.posix.join(path.posix.dirname(file), "renamed-" + path.posix.basename(file))] = {
                content: "",
                ignored: false,
              }
          }
          const { client } = fake(project)
          const expected = files.filter((_, i) => fates[i] !== "keep")
          const missing = await Pin.missingPins(client, session(files))
          expect(missing).toEqual(expected)
          const message = Pin.missingMessage(missing)
          if (expected.length === 0) return expect(message).toBeUndefined()
          const label = expected.length === 1 ? "Pinned file not found" : "Pinned files not found"
          expect(message).toBe(`${label}: ${expected.join(", ")}`)
        },
      ),
    )
  })

  // R5: Whenever at least one file is pinned, the UI shows an indicator listing exactly the pinned set.
  // Kind: round-trip at the command level. /pin then /unpin (spelled any way) restores the pinned
  // set the sidebar lists. Unpinning a path that isn't pinned, or a failed save, changes nothing.
  test("R5: /pin then /unpin restores the pinned set", async () => {
    await fc.assert(
      fc.asyncProperty(pinSet, spelling, fc.boolean(), async (files, prefix, fail) => {
        const [file, ...current] = files
        const project = Object.fromEntries(files.map((item) => [item, { content: "", ignored: false }]))
        const run = (pinned: string[], action: "pin" | "unpin", typed: string, options = {}) => {
          const { client, updates } = fake(project, options)
          return Pin.runPinCommand({ client, session: session(pinned), command: { action, path: typed } }).then(
            (result) => ({ result, updates }),
          )
        }

        expect((await run(current, "unpin", "")).result).toEqual({ type: "error", message: "Usage: /unpin <path>" })
        const absent = await run(current, "unpin", prefix + file)
        expect(absent.result).toEqual({ type: "error", message: `${file} is not pinned` })
        expect(absent.updates).toEqual([])

        const pinned = await run(current, "pin", file)
        if (pinned.result.type === "error") throw new Error(pinned.result.message)
        const unpinned = await run(pinned.result.files, "unpin", prefix + file, { fail })
        if (fail) return expect(unpinned.result).toEqual({ type: "error", message: `Failed to unpin ${file}` })
        expect(unpinned.result).toEqual({ type: "success", message: `Unpinned ${file}`, files: current })
        expect(unpinned.updates).toEqual([{ pinnedFiles: current }])
      }),
    )
  })
})
