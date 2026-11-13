import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { SessionPinned } from "../../src/session/pinned"

fc.configureGlobal({ seed: 42 })

// Generate valid relative paths, including nested folders.
// Short names help fast-check find duplicate and boundary cases.
const segment = fc
  .array(fc.constantFrom("a", "b", "c", "d", "e"), {
    minLength: 1,
    maxLength: 6,
  })
  .map((letters) => letters.join(""))

const filePath = fc
  .tuple(fc.array(segment, { minLength: 1, maxLength: 3 }), segment)
  .map(([folders, name]) => `${folders.join("/")}/${name}.ts`)

const fileContent = fc
  .array(fc.constantFrom("a", "b", "c", " ", "\n"), {
    minLength: 1,
    maxLength: 40,
  })
  .map((chars) => chars.join(""))

describe("SessionPinned property-based tests", () => {
  // R1: Once a user pins a file, it should stay pinned and be
  // included in future prompts until the user unpins it.
  // Kind: invariant
  test("R1: pinned files persist across repeated turns", () => {
    fc.assert(
      fc.property(filePath, fileContent, (file, content) => {
        let metadata: Record<string, unknown> = {}

        metadata = SessionPinned.withFiles(
          metadata,
          SessionPinned.add(SessionPinned.list(metadata), file),
        )

        for (let turn = 0; turn < 3; turn++) {
          const pinned = SessionPinned.list(metadata)
          expect(pinned).toContain(file)

          const request = SessionPinned.render(
            pinned.map((path) => ({ path, content, tokens: 1 })),
            100,
          )
          expect(request).toContain(`<pinned-file path="${file}">`)
          expect(request).toContain(content)
        }
      }),
    )
  })

  // R2: When a user unpins a file, it should disappear from the
  // pinned list and stop being automatically included in new prompts.
  // Kind: round-trip
  test("R2: pinning then unpinning restores the original state", () => {
    fc.assert(
      fc.property(filePath, fileContent, (file, content) => {
        const original: string[] = []
        const pinned = SessionPinned.add(original, file)
        const unpinned = SessionPinned.remove(pinned, file)

        expect(unpinned).toEqual(original)

        const request = SessionPinned.render(
          unpinned.map((path) => ({ path, content, tokens: 1 })),
          100,
        )
        expect(request).not.toContain(`<pinned-file path="${file}">`)
      }),
    )
  })

  // R5: Invalid files and duplicate pins should not create
  // invalid or duplicate pinned entries.
  // Kind: invariant
  test("R5: pinning the same file twice does not create duplicates", () => {
    fc.assert(
      fc.property(filePath, (file) => {
        const once = SessionPinned.add([], file)
        const twice = SessionPinned.add(once, file)

        expect(twice).toEqual(once)
        expect(twice.filter((path) => path === file)).toHaveLength(1)
      }),
    )
  })

  // R8: Pinned file contents should be included in model requests,
  // even when the user does not mention the file.
  // Kind: metamorphic
  // Adding another pinned file should not remove the original content
  // when both files fit within the context budget.
  test("R8: adding another file preserves existing pinned content", () => {
    fc.assert(
      fc.property(filePath, fileContent, filePath, fileContent,
        (file, content, otherFile, otherContent) => {
          fc.pre(file !== otherFile)

          const original = [{ path: file, content, tokens: 1 }]
          const extended = [
            ...original,
            { path: otherFile, content: otherContent, tokens: 1 },
          ]

          const first = SessionPinned.render(original, 100)
          const second = SessionPinned.render(extended, 100)

          const originalBlock = `<pinned-file path="${file}">\n${content}\n</pinned-file>`

          expect(first).toContain(originalBlock)
          expect(second).toContain(originalBlock)
          const newBlock = `<pinned-file path="${otherFile}">\n${otherContent}\n</pinned-file>`
          expect(second).toContain(newBlock)
        },
      ),
    )
  })
})
