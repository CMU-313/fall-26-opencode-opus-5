import { describe, expect, test } from "bun:test"
import PLAN_MODE from "../../src/session/prompt/plan-mode.txt"
import PLAN from "../../src/session/prompt/plan.txt"

const prompts = [
  ["enhanced plan mode", PLAN_MODE, "Do not edit any project files"],
  ["legacy plan mode", PLAN, "must not modify any project files"],
] as const

describe("plan prompts", () => {
  for (const [name, prompt, readOnlyInstruction] of prompts) {
    test(`${name} requests proposed changes and reasoning`, () => {
      expect(prompt).toContain("separate `Proposed Changes` and `Reasoning` sections")
      expect(prompt).toContain("identify each relevant file or component")
      expect(prompt).toContain("explain why each identified file or component is relevant")
      expect(prompt).toContain(readOnlyInstruction)
    })
  }
})
