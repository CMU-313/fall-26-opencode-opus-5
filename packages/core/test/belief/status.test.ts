import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { BeliefSchema } from "@opencode-ai/core/belief/schema"
import { BeliefStatus } from "@opencode-ai/core/belief/status"

const belief = (overrides: {
  assertions?: ReadonlyArray<unknown>
  rejections?: ReadonlyArray<unknown>
  evidence?: ReadonlyArray<unknown>
}) =>
  Schema.decodeUnknownSync(BeliefSchema.Belief)({
    id: "bel_test1",
    statement: "Test belief",
    topics: ["comments"],
    scope: ["**"],
    assertions: overrides.assertions ?? [{ by: "agent", how: "assumed", ref: "msg_1", at: 1_700_000_000_000 }],
    rejections: overrides.rejections ?? [],
    evidence: overrides.evidence ?? [],
  })

describe("BeliefStatus.derive", () => {
  test("an owner assertion alone is held", () => {
    expect(
      BeliefStatus.derive(belief({ assertions: [{ by: "owner", how: "stated", ref: "msg_1", at: 1_700_000_000_000 }] })),
    ).toBe("held")
  })

  test("an owner rejection newer than the owner assertion is rejected", () => {
    expect(
      BeliefStatus.derive(
        belief({
          assertions: [{ by: "owner", how: "stated", ref: "msg_1", at: 1_700_000_000_000 }],
          rejections: [{ by: "owner", ref: "msg_2", at: 1_700_000_100_000 }],
        }),
      ),
    ).toBe("rejected")
  })

  test("re-asserting after a rejection is held again (promotion)", () => {
    expect(
      BeliefStatus.derive(
        belief({
          assertions: [{ by: "owner", how: "confirmed", ref: "msg_3", at: 1_700_000_200_000 }],
          rejections: [{ by: "owner", ref: "msg_2", at: 1_700_000_100_000 }],
        }),
      ),
    ).toBe("held")
  })

  test("a rejection with no owner assertion at all is rejected", () => {
    expect(
      BeliefStatus.derive(
        belief({
          assertions: [{ by: "agent", how: "observed", ref: "msg_1", at: 1_700_000_000_000 }],
          rejections: [{ by: "owner", ref: "msg_2", at: 1_700_000_100_000 }],
        }),
      ),
    ).toBe("rejected")
  })

  test("corrections from two distinct sessions is learned", () => {
    expect(
      BeliefStatus.derive(
        belief({
          evidence: [
            { kind: "correction", ref: "msg_1", session: "ses_1", at: 1_700_000_000_000 },
            { kind: "correction", ref: "msg_2", session: "ses_2", at: 1_700_000_100_000 },
          ],
        }),
      ),
    ).toBe("learned")
  })

  test("one correction plus three acceptances across two sessions is learned", () => {
    expect(
      BeliefStatus.derive(
        belief({
          evidence: [
            { kind: "correction", ref: "msg_1", session: "ses_1", at: 1_700_000_000_000 },
            { kind: "acceptance", ref: "msg_2", session: "ses_1", at: 1_700_000_100_000 },
            { kind: "acceptance", ref: "msg_3", session: "ses_2", at: 1_700_000_200_000 },
            { kind: "acceptance", ref: "msg_4", session: "ses_2", at: 1_700_000_300_000 },
          ],
        }),
      ),
    ).toBe("learned")
  })

  test("a single correction from one session is only a hypothesis", () => {
    expect(
      BeliefStatus.derive(
        belief({
          evidence: [{ kind: "correction", ref: "msg_1", session: "ses_1", at: 1_700_000_000_000 }],
        }),
      ),
    ).toBe("hypothesis")
  })

  test("a contradiction newer than the supporting evidence prevents learned", () => {
    expect(
      BeliefStatus.derive(
        belief({
          evidence: [
            { kind: "correction", ref: "msg_1", session: "ses_1", at: 1_700_000_000_000 },
            { kind: "correction", ref: "msg_2", session: "ses_2", at: 1_700_000_100_000 },
            { kind: "contradiction", ref: "msg_3", session: "ses_3", at: 1_700_000_200_000 },
          ],
        }),
      ),
    ).toBe("hypothesis")
  })

  test("a contradiction older than the supporting evidence still allows learned", () => {
    expect(
      BeliefStatus.derive(
        belief({
          evidence: [
            { kind: "contradiction", ref: "msg_0", session: "ses_0", at: 1_699_999_000_000 },
            { kind: "correction", ref: "msg_1", session: "ses_1", at: 1_700_000_000_000 },
            { kind: "correction", ref: "msg_2", session: "ses_2", at: 1_700_000_100_000 },
          ],
        }),
      ),
    ).toBe("learned")
  })

  test("an agent-only assumption with no evidence is a hypothesis", () => {
    expect(BeliefStatus.derive(belief({}))).toBe("hypothesis")
  })
})
