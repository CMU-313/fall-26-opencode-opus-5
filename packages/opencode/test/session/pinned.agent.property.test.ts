import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { SessionPinned } from "../../src/session/pinned"

const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/)
const filePath = fc
  .tuple(fc.array(segment, { maxLength: 3 }), segment)
  .map(([directories, file]) => [...directories, `${file}.ts`].join("/"))
const fileContent = fc.string({ unit: "grapheme", maxLength: 200 })

describe("SessionPinned properties", () => {
  test("R8: adding a file within the token budget preserves existing content", () => {
    fc.assert(
      fc.property(
        filePath,
        fileContent,
        fc.integer({ min: 0, max: 100 }),
        filePath,
        fileContent,
        fc.integer({ min: 0, max: 100 }),
        (file, content, tokens, otherFile, otherContent, otherTokens) => {
          fc.pre(file !== otherFile)

          const original = [{ path: file, content, tokens }]
          const extended = [...original, { path: otherFile, content: otherContent, tokens: otherTokens }]
          const budget = tokens + otherTokens
          const originalBlock = `<pinned-file path="${file}">\n${content}\n</pinned-file>`
          const otherBlock = `<pinned-file path="${otherFile}">\n${otherContent}\n</pinned-file>`

          expect(SessionPinned.render(original, budget)).toContain(originalBlock)
          expect(SessionPinned.render(extended, budget)).toContain(originalBlock)
          expect(SessionPinned.render(extended, budget)).toContain(otherBlock)
        },
      ),
    )
  })

  test("pinning and then unpinning a file removes it from the pinned list", () => {
    fc.assert(
      fc.property(filePath, (file) => {
        const pinned = SessionPinned.add([], file)
        const unpinned = SessionPinned.remove(pinned, file)

        expect(unpinned).not.toContain(SessionPinned.normalize(file))
      }),
    )
  })
})
