import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"
import { Pinned } from "@opencode-ai/core/util/pinned"
import { runPinCommand } from "../../src/component/prompt/pin"

// Fixed seed so generated cases are reproducible across runs.
fc.configureGlobal({ seed: 20261113 })

// A fake SDK client backed by a single in-memory file. `file.list` reports that one file for any
// directory, `file.read` returns the given content, and `session.update` records metadata and
// echoes a session back. No network or real project is involved.
function fakeClient(input: { file: string; ignored: boolean; content: string }) {
  const updates: Array<Record<string, unknown> | undefined> = []
  const client = {
    file: {
      list: async () => ({
        data: [
          {
            name: input.file.split("/").pop()!,
            path: input.file,
            absolute: "/" + input.file,
            type: "file",
            ignored: input.ignored,
          },
        ],
      }),
      read: async () => ({ data: { type: "text", content: input.content } }),
    },
    session: {
      update: async (args: { metadata?: Record<string, unknown> }) => {
        updates.push(args.metadata)
        return { data: { id: "ses_test" } }
      },
    },
  }
  return { client: client as unknown as OpencodeClient, updates }
}

const session = (metadata?: Record<string, unknown>) =>
  ({ id: "ses_test", metadata }) as unknown as Session

// Relative file paths made of safe segments so `Pinned.normalize` leaves them unchanged.
const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/)
const fileName = fc
  .tuple(segment, fc.constantFrom("", ".ts", ".md", ".json", ".min.js"))
  .map(([base, ext]) => base + ext)
const filePath = fc
  .tuple(fc.array(segment, { maxLength: 3 }), fileName)
  .map(([dirs, name]) => [...dirs, name].join("/"))
const content = fc.string({ maxLength: 40 })

describe("R2: /pin warns for gitignored files only", () => {
  test("ignored files pin with a warning; non-ignored files pin without one", async () => {
    await fc.assert(
      fc.asyncProperty(filePath, fc.boolean(), content, async (file, ignored, text) => {
        const { client } = fakeClient({ file, ignored, content: text })
        const result = await runPinCommand({
          client,
          session: session(),
          command: { action: "pin", path: file },
        })

        const pinned = Pinned.normalize(file)
        if (ignored) {
          expect(result.type).toBe("warning")
          if (result.type === "warning") {
            expect(result.message).toContain(`${pinned} matches .gitignore`)
            expect(result.files).toContain(pinned)
          }
        } else {
          expect(result.type).toBe("success")
          if (result.type === "success") {
            expect(result.message).not.toContain(".gitignore")
            expect(result.files).toContain(pinned)
          }
        }
      }),
    )
  })
})
// ---------------------------------------------------------------------------------------------
// Strengthened version (P5 agent failure case). Everything above is opencode's property, unchanged.
// It let two mutants survive:
//   H2 (mutants/zacharyf/H2.patch): the generator never makes dotfiles, so `.env`, the main
//       gitignored case in R2's acceptance criteria, is never pinned.
//   H8 (mutants/zacharyf/H8.patch): it checks only the returned `files`, never that the pin was
//       saved to the session, so a warning with no save still passes.
// This version adds dotfiles to the generator and checks the saved metadata.
const dotfile = fc.constantFrom(".env", ".gitignore", ".npmrc", ".env.local", ".prettierrc")
const strongPath = fc
  .tuple(fc.array(segment, { maxLength: 3 }), fc.oneof(fileName, dotfile))
  .map(([dirs, name]) => [...dirs, name].join("/"))

describe("R2 (strengthened): /pin warns for gitignored files only", () => {
  test("ignored files, dotfiles included, are saved and warned about; others are saved without a warning", async () => {
    await fc.assert(
      fc.asyncProperty(strongPath, fc.boolean(), content, async (file, ignored, text) => {
        const { client, updates } = fakeClient({ file, ignored, content: text })
        const result = await runPinCommand({
          client,
          session: session(),
          command: { action: "pin", path: file },
        })

        const pinned = Pinned.normalize(file)
        expect(result).toEqual({
          type: ignored ? "warning" : "success",
          message: ignored ? `Pinned ${pinned}. ${pinned} matches .gitignore` : `Pinned ${pinned}`,
          files: [pinned],
        })
        expect(updates).toEqual([{ [Pinned.METADATA_KEY]: [pinned] }])
      }),
    )
  })
})
