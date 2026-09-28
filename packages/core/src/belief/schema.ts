export * as BeliefSchema from "./schema"

import { create } from "@opencode-ai/schema/identifier"
import { Effect, Schema } from "effect"
import { DateTimeUtcFromMillis, statics } from "../schema"
import { SessionSchema } from "../session/schema"

const MAX_EVIDENCE = 10

/** Stable, normalized topic identity shared by a store's vocabulary and its beliefs. */
export const Topic = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)).pipe(
  Schema.brand("Belief.Topic"),
)
export type Topic = typeof Topic.Type

export function normalizeTopic(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-")
}

export const ID = Schema.String.check(Schema.isStartsWith("bel")).pipe(
  Schema.brand("Belief.ID"),
  statics((schema) => ({ create: (id?: string) => schema.make(id ?? "bel_" + create(false)) })),
)
export type ID = typeof ID.Type

const OwnerAssertion = Schema.Struct({
  by: Schema.Literal("owner"),
  how: Schema.Literals(["stated", "confirmed"]),
  ref: Schema.String,
  at: DateTimeUtcFromMillis,
})

const AgentAssertion = Schema.Struct({
  by: Schema.Literal("agent"),
  how: Schema.Literals(["learned", "observed", "assumed"]),
  ref: Schema.String,
  at: DateTimeUtcFromMillis,
})

/** Provenance for a belief. Owner and agent participants can only assert with their own vocabulary of `how`. */
export const Assertion = Schema.Union([OwnerAssertion, AgentAssertion]).annotate({
  identifier: "Belief.Assertion",
})
export type Assertion = typeof Assertion.Type

/** Only the owner can reject a belief. */
export const Rejection = Schema.Struct({
  by: Schema.Literal("owner"),
  ref: Schema.String,
  at: DateTimeUtcFromMillis,
}).annotate({ identifier: "Belief.Rejection" })
export type Rejection = typeof Rejection.Type

export const Evidence = Schema.Struct({
  kind: Schema.Literals(["correction", "acceptance", "contradiction"]),
  ref: Schema.String,
  session: SessionSchema.ID,
  at: DateTimeUtcFromMillis,
}).annotate({ identifier: "Belief.Evidence" })
export type Evidence = typeof Evidence.Type

const uniqueParticipants = Schema.makeFilter<ReadonlyArray<Assertion>>((assertions) => {
  const seen = new Set<Assertion["by"]>()
  for (const assertion of assertions) {
    if (seen.has(assertion.by)) return `at most one assertion per participant is allowed, duplicate: ${assertion.by}`
    seen.add(assertion.by)
  }
  return undefined
})

/**
 * Requires at least one assertion (provenance) and at most one per
 * participant at decode time. Re-asserting to refresh a participant's `at`
 * is a write-time merge, handled by the store rather than the schema.
 */
export const Belief = Schema.Struct({
  id: ID,
  statement: Schema.NonEmptyString,
  topics: Schema.NonEmptyArray(Topic),
  scope: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(["**"]))),
  assertions: Schema.NonEmptyArray(Assertion).check(uniqueParticipants),
  rejections: Schema.Array(Rejection),
  evidence: Schema.Array(Evidence).check(Schema.isMaxLength(MAX_EVIDENCE)),
}).annotate({ identifier: "Belief.Belief" })
export type Belief = typeof Belief.Type

const topicsInVocabulary = Schema.makeFilter<{ topics: ReadonlyArray<Topic>; beliefs: ReadonlyArray<Belief> }>(
  ({ topics, beliefs }) => {
    const vocabulary = new Set<string>(topics)
    return beliefs.flatMap((belief, index) =>
      belief.topics
        .filter((topic) => !vocabulary.has(topic))
        .map((topic) => ({
          path: ["beliefs", index, "topics"],
          issue: `topic "${topic}" is not in the file's topics vocabulary`,
        })),
    )
  },
)

/** Top-level belief store file: `{ version, topics, beliefs }`, shared by the project and personal stores. */
export const Store = Schema.Struct({
  version: Schema.Literal(1),
  topics: Schema.Array(Topic),
  beliefs: Schema.Array(Belief),
})
  .check(topicsInVocabulary)
  .annotate({ identifier: "Belief.Store" })
export type Store = typeof Store.Type
