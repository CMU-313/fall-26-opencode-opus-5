import { describe, expect, test } from "bun:test"
import { SessionPinned } from "../../src/session/pinned"

describe("SessionPinned state", () => {
  test("list reads pinned files from session metadata", () => {
    expect(SessionPinned.list(undefined)).toEqual([])
    expect(SessionPinned.list({})).toEqual([])
    expect(SessionPinned.list({ pinnedFiles: "src/a.ts" })).toEqual([])
    expect(SessionPinned.list({ pinnedFiles: ["src/a.ts", 3, "", "src/b.ts"] })).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("add appends a normalized path once", () => {
    const one = SessionPinned.add([], "./src/a.ts")
    expect(one).toEqual(["src/a.ts"])
    expect(SessionPinned.add(one, "src/a.ts")).toEqual(["src/a.ts"])
    expect(SessionPinned.add(one, "@src/b.ts")).toEqual(["src/a.ts", "src/b.ts"])
    expect(SessionPinned.add(one, "  ")).toEqual(["src/a.ts"])
  })

  test("add does not mutate the input list", () => {
    const files = ["src/a.ts"]
    SessionPinned.add(files, "src/b.ts")
    expect(files).toEqual(["src/a.ts"])
  })

  test("remove drops a pinned path and ignores unknown paths", () => {
    const files = ["src/a.ts", "src/b.ts"]
    expect(SessionPinned.remove(files, "./src/a.ts")).toEqual(["src/b.ts"])
    expect(SessionPinned.remove(files, "src/missing.ts")).toEqual(files)
    expect(SessionPinned.remove([], "src/a.ts")).toEqual([])
  })

  test("pin then unpin round-trips through metadata without touching other keys", () => {
    const metadata = { other: true }
    const pinned = SessionPinned.withFiles(metadata, SessionPinned.add(SessionPinned.list(metadata), "src/a.ts"))
    expect(pinned).toEqual({ other: true, pinnedFiles: ["src/a.ts"] })
    const unpinned = SessionPinned.withFiles(pinned, SessionPinned.remove(SessionPinned.list(pinned), "src/a.ts"))
    expect(unpinned).toEqual({ other: true, pinnedFiles: [] })
  })
})

describe("SessionPinned bounds", () => {
  test("limit uses a share of the model context, capped at MAX_TOKENS", () => {
    expect(SessionPinned.limit({ limit: { context: 8_000 } })).toBe(2_000)
    expect(SessionPinned.limit({ limit: { context: 1_000_000 } })).toBe(SessionPinned.MAX_TOKENS)
    expect(SessionPinned.limit({ limit: { context: 0 } })).toBe(SessionPinned.MAX_TOKENS)
    expect(SessionPinned.limit()).toBe(SessionPinned.MAX_TOKENS)
  })

  test("check passes at the limit and fails above it", () => {
    expect(SessionPinned.check(99, 100)).toEqual({ ok: true, tokens: 99, limit: 100 })
    expect(SessionPinned.check(100, 100).ok).toBe(true)
    expect(SessionPinned.check(101, 100)).toEqual({ ok: false, tokens: 101, limit: 100 })
  })

  test("render includes files within the limit and marks the rest as omitted instead of truncating", () => {
    const text = SessionPinned.render(
      [
        { path: "a.ts", content: "const alpha = 1", tokens: 60 },
        { path: "b.ts", content: "const beta = 2", tokens: 60 },
        { path: "c.ts", content: undefined, tokens: 0 },
      ],
      100,
    )
    expect(text).toContain('<pinned-file path="a.ts">\nconst alpha = 1\n</pinned-file>')
    expect(text).not.toContain("const beta = 2")
    expect(text).toContain('<pinned-file path="b.ts" omitted="true">')
    expect(text).toContain('<pinned-file path="c.ts" missing="true">')
  })
})
