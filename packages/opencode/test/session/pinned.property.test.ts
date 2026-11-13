import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import fc from "fast-check"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionPinned } from "../../src/session/pinned"

// Fixed seed so mutation runs (Stryker, hand-written mutants) are reproducible.
fc.configureGlobal({ seed: 17313 })

const layer = LayerNode.compile(LayerNode.group([FSUtil.node]))
const load = (files: string[], directory: string) =>
  Effect.runPromise(SessionPinned.load({ files, directory }).pipe(Effect.provide(layer)))

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
// A set of pins where no path is a directory of another, so all can exist on disk at once.
const pinSet = fc
  .uniqueArray(filePath, { minLength: 1, maxLength: 5 })
  .filter((files) => files.every((a) => files.every((b) => !b.startsWith(a + "/"))))
// File contents including unicode and empty files.
const content = fc.string({ unit: "grapheme", maxLength: 200 })

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "pinned-prop-"))
const write = async (dir: string, file: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true })
  await fs.writeFile(path.join(dir, file), text)
}
const block = (file: string, text: string) => `<pinned-file path="${file}">\n${text}\n</pinned-file>`

// R1, R2 and the user-facing part of R4 are in packages/tui/test/prompt/pin.property.test.ts.
describe("pinned file properties", () => {
  // R3: Pinned file contents are read when each message is sent, not when the file is pinned.
  // Kind: metamorphic (changing the file from A to B changes the rendered context from A to B)
  test("R3: edits made after pinning show up on the next send", async () => {
    await fc.assert(
      fc.asyncProperty(filePath, content, content, async (file, before, after) => {
        fc.pre(before !== after)
        const dir = await tmp()
        try {
          await write(dir, file, before)
          const first = SessionPinned.render(await load([file], dir), SessionPinned.MAX_TOKENS)
          await write(dir, file, after)
          const second = SessionPinned.render(await load([file], dir), SessionPinned.MAX_TOKENS)
          expect(first).toContain(block(file, before))
          expect(second).toContain(block(file, after))
          expect(second).not.toContain(block(file, before))
          // Each block is on its own line after a header line that tells the model what the blocks are.
          const [header] = second.split("\n")
          expect(header).toContain("pinned")
          expect(header.startsWith("<pinned-file")).toBe(false)
          expect(second).toContain("\n" + block(file, after))
        } finally {
          await fs.rm(dir, { recursive: true, force: true })
        }
      }),
      { numRuns: 50 },
    )
  })

  // R3: same requirement, under the pinned-token cap. Kind: model/oracle. Files are rendered in
  // pin order. A readable file's current contents are sent while the running total stays within the
  // cap. A file that would go over it is marked omitted, and later files that still fit are sent.
  test("R3: current contents are sent in pin order up to the token cap", () => {
    const loaded = fc.record({
      path: filePath,
      content: fc.option(content, { nil: undefined }),
      tokens: fc.integer({ min: 0, max: 10 }),
    })
    fc.assert(
      fc.property(fc.array(loaded, { maxLength: 6 }), fc.integer({ min: 0, max: 30 }), (files, max) => {
        const text = SessionPinned.render(files, max)
        let used = 0
        const blocks = files.map((file) => {
          if (file.content === undefined) return `<pinned-file path="${file.path}" missing="true">`
          if (used + file.tokens > max) return `<pinned-file path="${file.path}" omitted="true">`
          used += file.tokens
          return block(file.path, file.content)
        })
        const [header, ...rest] = text.split("\n")
        expect(header).toContain("pinned")
        const body = rest.join("\n")
        // Walk the body: each expected block (or its opening tag, for missing/omitted) must come next,
        // with blocks separated by newlines and nothing left over.
        let from = 0
        for (const [i, expected] of blocks.entries()) {
          if (i > 0) expect(body[from++]).toBe("\n")
          expect(body.startsWith(expected, from)).toBe(true)
          from = expected.endsWith("</pinned-file>")
            ? from + expected.length
            : body.indexOf("</pinned-file>", from) + "</pinned-file>".length
        }
        expect(from).toBe(body.length)
      }),
    )
  })

  // R4: If a pinned file is deleted or renamed, the next message shows a "file not found" error for
  // that path, still sends with the remaining pins, and does not move the pin to the new path.
  // Kind: model/oracle (expected request text computed from each pin's fate: kept, deleted or renamed).
  // This covers what is sent to the model; the user-facing error is checked in the TUI property.
  test("R4: deleted or renamed pins are marked missing and the rest still send", async () => {
    // "directory": the file was deleted and a folder with the same name created. "outside": the pin
    // (set directly in metadata) points at a real file outside the project; it must never be read.
    const fate = fc.constantFrom("keep", "delete", "rename", "directory", "outside")
    await fc.assert(
      fc.asyncProperty(
        pinSet.chain((files) =>
          fc.tuple(fc.constant(files), fc.array(fate, { minLength: files.length, maxLength: files.length })),
        ),
        async ([files, fates]) => {
          const dir = await tmp()
          const other = await tmp()
          try {
            const pins = files.map((file, i) =>
              fates[i] === "outside" ? path.relative(dir, path.join(other, file)) : file,
            )
            for (const file of files) await write(dir, file, `content of ${file}`)
            for (const file of files) await write(other, file, `outside ${file}`)
            for (const [i, file] of files.entries()) {
              if (fates[i] === "delete" || fates[i] === "directory") await fs.rm(path.join(dir, file))
              if (fates[i] === "directory") await fs.mkdir(path.join(dir, file))
              if (fates[i] === "rename") await fs.rename(path.join(dir, file), path.join(dir, file + ".renamed"))
            }
            const text = SessionPinned.render(await load(pins, dir), SessionPinned.MAX_TOKENS)
            for (const [i, pin] of pins.entries()) {
              if (fates[i] === "keep") expect(text).toContain(block(pin, `content of ${pin}`))
              else expect(text).toContain(`<pinned-file path="${pin}" missing="true">`)
              expect(text).not.toContain(`path="${pin}.renamed"`)
              expect(text).not.toContain(`outside ${files[i]}`)
            }
          } finally {
            await fs.rm(dir, { recursive: true, force: true })
            await fs.rm(other, { recursive: true, force: true })
          }
        },
      ),
      { numRuns: 50 },
    )
  })

  // R5: Whenever at least one file is pinned, the UI shows an indicator listing exactly the pinned set.
  // Kind: model/oracle. The sidebar renders Pinned.list(metadata), so any sequence of pins and unpins
  // stored through session metadata must match a simple ordered-set model.
  test("R5: the listed pins match a set model after any pin/unpin sequence", () => {
    const op = fc.record({
      action: fc.constantFrom("pin", "unpin"),
      file: fc.constantFrom("a.ts", "b.ts", ".env", "src/c.md"),
    })
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), (ops) => {
        let metadata: Record<string, unknown> = { other: true }
        let model: string[] = []
        for (const { action, file } of ops) {
          const current = SessionPinned.list(metadata)
          const next = action === "pin" ? SessionPinned.add(current, file) : SessionPinned.remove(current, file)
          metadata = SessionPinned.withFiles(metadata, next)
          if (action === "pin" && !model.includes(file)) model = [...model, file]
          if (action === "unpin") model = model.filter((item) => item !== file)
        }
        expect(SessionPinned.list(metadata)).toEqual(model)
        expect(metadata.other).toBe(true)
      }),
    )
  })

  // R5: pinning then unpinning a file leaves the listed set exactly as it was.
  // Kind: round-trip. The file may be spelled differently each time ("./a.ts", "@a.ts", "a.ts"),
  // as the user can type it either way.
  test("R5: pin then unpin returns the original pinned set", () => {
    const spelling = fc.constantFrom("", "./", "@")
    fc.assert(
      fc.property(pinSet, filePath, spelling, spelling, (files, file, pinAs, unpinAs) => {
        fc.pre(!files.includes(file))
        const metadata = SessionPinned.withFiles({}, files)
        const pinned = SessionPinned.withFiles(metadata, SessionPinned.add(SessionPinned.list(metadata), pinAs + file))
        expect(SessionPinned.list(pinned)).toEqual([...files, file])
        const unpinned = SessionPinned.withFiles(
          pinned,
          SessionPinned.remove(SessionPinned.list(pinned), unpinAs + file),
        )
        expect(SessionPinned.list(unpinned)).toEqual(files)
      }),
    )
  })
})
