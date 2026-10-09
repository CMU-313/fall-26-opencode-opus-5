import { describe, expect, test } from "bun:test"
import { parsePinCommand } from "../../src/component/prompt/pin"

describe("parsePinCommand", () => {
  test("parses /pin and /unpin with a path", () => {
    expect(parsePinCommand("/pin src/a.ts")).toEqual({ action: "pin", path: "src/a.ts" })
    expect(parsePinCommand("  /unpin   src/a.ts  ")).toEqual({ action: "unpin", path: "src/a.ts" })
  })

  test("keeps paths with spaces intact", () => {
    expect(parsePinCommand("/pin docs/my notes.md")).toEqual({ action: "pin", path: "docs/my notes.md" })
  })

  test("returns an empty path when none is given so the caller can show usage", () => {
    expect(parsePinCommand("/pin")).toEqual({ action: "pin", path: "" })
    expect(parsePinCommand("/unpin ")).toEqual({ action: "unpin", path: "" })
  })

  test("ignores other input", () => {
    expect(parsePinCommand("pin src/a.ts")).toBeUndefined()
    expect(parsePinCommand("/pinned")).toBeUndefined()
    expect(parsePinCommand("/pinsrc/a.ts")).toBeUndefined()
    expect(parsePinCommand("/compact")).toBeUndefined()
  })
})
