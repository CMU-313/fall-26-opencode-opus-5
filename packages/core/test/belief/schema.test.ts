import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { BeliefSchema } from "@opencode-ai/core/belief/schema"

const fullBelief = {
  id: "bel_test1",
  statement: "Comments should explain why, not what.",
  topics: ["comments"],
  scope: ["packages/core/**"],
  assertions: [{ by: "owner", how: "stated", ref: "msg_1", at: 1700000000000 }],
  rejections: [{ by: "owner", ref: "msg_2", at: 1700000100000 }],
  evidence: [{ kind: "correction", ref: "msg_3", session: "ses_test1", at: 1700000200000 }],
}

describe("BeliefSchema.Belief", () => {
  test("round-trips with every field intact", () => {
    const decoded = Schema.decodeUnknownSync(BeliefSchema.Belief)(fullBelief)
    expect(decoded.statement).toBe(fullBelief.statement)
    expect(decoded.assertions).toHaveLength(1)
    expect(decoded.assertions[0].by).toBe("owner")
    expect(decoded.rejections).toHaveLength(1)
    expect(decoded.evidence).toHaveLength(1)
    // Branded (`ID`, `Topic`) and transformed (`at`) fields aren't directly
    // comparable to the raw input's plain types, so encode the decoded value
    // back and compare the resulting JSON for full round-trip fidelity.
    expect(JSON.stringify(Schema.encodeSync(BeliefSchema.Belief)(decoded))).toBe(JSON.stringify(fullBelief))
  })

  test("defaults scope to [\"**\"] when omitted", () => {
    const { scope: _scope, ...withoutScope } = fullBelief
    const decoded = Schema.decodeUnknownSync(BeliefSchema.Belief)(withoutScope)
    expect(decoded.scope).toEqual(["**"])
  })

  test("rejects a belief with no assertions", () => {
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Belief)({ ...fullBelief, assertions: [] })).toThrow()
  })

  test("rejects two assertions from the same participant", () => {
    const duplicateOwner = {
      ...fullBelief,
      assertions: [
        { by: "owner", how: "stated", ref: "msg_1", at: 1700000000000 },
        { by: "owner", how: "confirmed", ref: "msg_4", at: 1700000300000 },
      ],
    }
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Belief)(duplicateOwner)).toThrow()

    const duplicateAgent = {
      ...fullBelief,
      assertions: [
        { by: "agent", how: "assumed", ref: "msg_1", at: 1700000000000 },
        { by: "agent", how: "observed", ref: "msg_4", at: 1700000300000 },
      ],
    }
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Belief)(duplicateAgent)).toThrow()
  })

  test("rejects an owner assertion with an agent-only how, and vice versa", () => {
    expect(() =>
      Schema.decodeUnknownSync(BeliefSchema.Belief)({
        ...fullBelief,
        assertions: [{ by: "owner", how: "learned", ref: "msg_1", at: 1700000000000 }],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(BeliefSchema.Belief)({
        ...fullBelief,
        assertions: [{ by: "agent", how: "stated", ref: "msg_1", at: 1700000000000 }],
      }),
    ).toThrow()
  })

})

describe("BeliefSchema.Topic", () => {
  test("accepts normalized lowercase-kebab-case topics", () => {
    expect(String(Schema.decodeUnknownSync(BeliefSchema.Topic)("control-flow"))).toBe("control-flow")
    expect(String(Schema.decodeUnknownSync(BeliefSchema.Topic)("comments"))).toBe("comments")
  })

  test("rejects uppercase, spaces, and underscores", () => {
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Topic)("Control-Flow")).toThrow()
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Topic)("control flow")).toThrow()
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Topic)("control_flow")).toThrow()
  })

  test("normalizeTopic trims, lowercases, and hyphenates whitespace", () => {
    expect(BeliefSchema.normalizeTopic("  Control  Flow  ")).toBe("control-flow")
  })
})

describe("BeliefSchema.Store", () => {
  const store = {
    version: 1 as const,
    topics: ["comments"],
    beliefs: [fullBelief],
  }

  test("round-trips a store with its vocabulary", () => {
    const decoded = Schema.decodeUnknownSync(BeliefSchema.Store)(store)
    expect(decoded.topics.map(String)).toEqual(["comments"])
    expect(decoded.beliefs).toHaveLength(1)
  })

  test("rejects a belief topic missing from the store's vocabulary", () => {
    const missingVocabulary = { version: 1 as const, topics: [], beliefs: [fullBelief] }
    expect(() => Schema.decodeUnknownSync(BeliefSchema.Store)(missingVocabulary)).toThrow()
  })
})
