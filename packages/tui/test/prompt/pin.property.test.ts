import { describe, expect, test } from "bun:test"
import path from "path"
import fc from "fast-check"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"
import * as Pin from "../../src/component/prompt/pin"

type FakeFile = { content: string; ignored: boolean }

// A fake SDK client backed by an in-memory project. file.list returns the direct children of a
// directory the way the server does (files plus the directories that contain them), file.read
// returns contents, and session.update records the metadata it was given.
function fake(project: Record<string, FakeFile>) {
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
        data: project[file] ? { type: "text", content: project[file].content } : undefined,
      }),
    },
    session: {
      update: async ({ metadata }: { metadata: Record<string, unknown> }) => {
        updates.push(metadata)
        return { data: {} }
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
// Short contents keep token usage far below the 80% warning threshold, so only the gitignore
// flag can cause a warning.
const content = fc.string({ maxLength: 100 })

describe("pin command properties", () => {
  // R1: Any existing file in the project can be pinned, regardless of extension or read-only status.
  // Kind: invariant (for every existing path and already-pinned set, the pin succeeds and is stored)
  test("R1: any existing file can be pinned", async () => {
    await fc.assert(
      fc.asyncProperty(pinSet, fc.boolean(), content, async (files, ignored, text) => {
        const [file, ...current] = files
        const project = Object.fromEntries(files.map((item) => [item, { content: text, ignored }]))
        const { client, updates } = fake(project)
        const result = await Pin.runPinCommand({
          client,
          session: session(current),
          command: { action: "pin", path: file },
        })
        expect(result.type).not.toBe("error")
        if (result.type === "error") return
        expect(result.files).toEqual([...current, file])
        expect(updates.at(-1)?.pinnedFiles).toEqual([...current, file])
      }),
    )
  })

  // R2: Pinning a file that matches .gitignore succeeds but shows a warning.
  // Kind: invariant (warning iff the file listing marks the file ignored, for every path)
  test("R2: gitignored files are pinned with a warning, others without", async () => {
    await fc.assert(
      fc.asyncProperty(filePath, fc.boolean(), content, async (file, ignored, text) => {
        const { client } = fake({ [file]: { content: text, ignored } })
        const result = await Pin.runPinCommand({
          client,
          session: session([]),
          command: { action: "pin", path: file },
        })
        expect(result.type).toBe(ignored ? "warning" : "success")
        expect(result.message.includes("matches .gitignore")).toBe(ignored)
      }),
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
          expect(message!.slice(message!.indexOf(": ") + 2).split(", ")).toEqual(expected)
        },
      ),
    )
  })
})
