export * as BeliefStore from "./store"

import path from "path"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Location } from "../location"
import { BeliefSchema } from "./schema"

export type Target = "project" | "personal"

const empty: BeliefSchema.Store = { version: 1, topics: [], beliefs: [] }

/** A store file exists but failed to decode. Distinct from a missing file, which loads as `empty`. */
export const unavailable: symbol = Symbol.for("@opencode/BeliefStore.Unavailable")
export type Unavailable = symbol

export type AssertionInput =
  | { readonly by: "owner"; readonly how: "stated" | "confirmed"; readonly ref: string }
  | { readonly by: "agent"; readonly how: "learned" | "observed" | "assumed"; readonly ref: string }

export interface ProposeInput {
  readonly statement: string
  readonly topics: ReadonlyArray<string>
  readonly scope?: ReadonlyArray<string>
  readonly assertion: AssertionInput
}

export type Outcome =
  | { readonly _tag: "unavailable"; readonly unknownTopics: ReadonlyArray<string> }
  | { readonly _tag: "rejected"; readonly unknownTopics: ReadonlyArray<string> }
  | { readonly _tag: "merged"; readonly id: BeliefSchema.ID; readonly unknownTopics: ReadonlyArray<string> }
  | {
      readonly _tag: "related"
      readonly id: BeliefSchema.ID
      readonly relatedIds: ReadonlyArray<BeliefSchema.ID>
      readonly unknownTopics: ReadonlyArray<string>
    }
  | {
      readonly _tag: "refines"
      readonly id: BeliefSchema.ID
      readonly relation: "subset" | "superset"
      readonly relatedId: BeliefSchema.ID
      readonly unknownTopics: ReadonlyArray<string>
    }
  | { readonly _tag: "added"; readonly id: BeliefSchema.ID; readonly unknownTopics: ReadonlyArray<string> }

export interface Interface {
  readonly load: (target: Target) => Effect.Effect<BeliefSchema.Store | Unavailable>
  readonly write: (target: Target, store: BeliefSchema.Store) => Effect.Effect<void, FSUtil.Error>
  /**
   * Classifies and persists a proposed belief using structure only (normalized
   * statement, topic set, scope overlap) against the target store. Never
   * removes or overrides an existing owner assertion.
   */
  readonly propose: (target: Target, input: ProposeInput) => Effect.Effect<Outcome, FSUtil.Error>
  readonly confirm: (
    target: Target,
    id: BeliefSchema.ID,
    input: { readonly ref: string },
  ) => Effect.Effect<BeliefSchema.Belief | undefined, FSUtil.Error>
  readonly reject: (
    target: Target,
    id: BeliefSchema.ID,
    input: { readonly ref: string },
  ) => Effect.Effect<BeliefSchema.Belief | undefined, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BeliefStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service

    const filePath = (target: Target) =>
      target === "personal"
        ? path.join(global.config, "beliefs.json")
        : path.join(location.project.directory, ".opencode", "beliefs.json")

    const loadFile = Effect.fn("BeliefStore.load")(function* (target: Target) {
      if (target === "project" && Flag.OPENCODE_DISABLE_PROJECT_CONFIG) return empty
      const text = yield* fs.readFileStringSafe(filePath(target))
      if (text === undefined) return empty
      return Option.getOrElse(
        Schema.decodeUnknownOption(Schema.fromJsonString(BeliefSchema.Store))(text),
        () => unavailable,
      )
    })

    const load = (target: Target) =>
      loadFile(target).pipe(
        Effect.catch(() => Effect.succeed(unavailable)),
        Effect.catchDefect(() => Effect.succeed(unavailable)),
      )

    const write = Effect.fn("BeliefStore.write")(function* (target: Target, store: BeliefSchema.Store) {
      const sorted = sortBeliefs(store)
      const content = JSON.stringify(Schema.encodeSync(BeliefSchema.Store)(sorted), null, 2) + "\n"
      yield* fs.writeWithDirs(filePath(target), content)
    })

    const createBelief = Effect.fn("BeliefStore.createBelief")(function* (
      topics: ReadonlyArray<string>,
      scope: ReadonlyArray<string>,
      input: ProposeInput,
    ) {
      const now = yield* DateTime.now
      return Schema.decodeUnknownSync(BeliefSchema.Belief)({
        id: BeliefSchema.ID.create(),
        statement: input.statement.trim(),
        topics,
        scope,
        assertions: [{ ...input.assertion, at: DateTime.toEpochMillis(now) }],
        rejections: [],
        evidence: [],
      })
    })

    const withAssertion = Effect.fn("BeliefStore.withAssertion")(function* (
      belief: BeliefSchema.Belief,
      assertion: AssertionInput,
    ) {
      const now = yield* DateTime.now
      const encoded = Schema.encodeSync(BeliefSchema.Belief)(belief)
      const assertions = [...encoded.assertions.filter((existing) => existing.by !== assertion.by), { ...assertion, at: DateTime.toEpochMillis(now) }]
      return Schema.decodeUnknownSync(BeliefSchema.Belief)({ ...encoded, assertions })
    })

    const withRejection = Effect.fn("BeliefStore.withRejection")(function* (
      belief: BeliefSchema.Belief,
      input: { readonly ref: string },
    ) {
      const now = yield* DateTime.now
      const encoded = Schema.encodeSync(BeliefSchema.Belief)(belief)
      const rejections = [...encoded.rejections, { by: "owner" as const, ref: input.ref, at: DateTime.toEpochMillis(now) }]
      return Schema.decodeUnknownSync(BeliefSchema.Belief)({ ...encoded, rejections })
    })

    const replaceBelief = (store: BeliefSchema.Store, updated: BeliefSchema.Belief): BeliefSchema.Store => ({
      ...store,
      beliefs: store.beliefs.map((belief) => (belief.id === updated.id ? updated : belief)),
    })

    const propose = Effect.fn("BeliefStore.propose")(function* (target: Target, input: ProposeInput) {
      const current = yield* load(target)
      const normalizedTopics = input.topics.map(BeliefSchema.normalizeTopic)
      const unknownTopics = typeof current === "symbol" ? [] : unknownVocabulary(current.topics, normalizedTopics)
      if (typeof current === "symbol") return { _tag: "unavailable" as const, unknownTopics }

      const normalizedStatement = normalizeStatement(input.statement)
      const scope = input.scope ?? ["**"]

      const rejectedMatch = current.beliefs.find(
        (belief) =>
          isRejected(belief) &&
          normalizeStatement(belief.statement) === normalizedStatement &&
          sameTopics(belief.topics, normalizedTopics) &&
          scopesOverlap(belief.scope, scope),
      )
      if (rejectedMatch) return { _tag: "rejected" as const, unknownTopics }

      const store = { ...current, topics: mergeVocabulary(current.topics, normalizedTopics) }

      const mergedMatch = current.beliefs.find(
        (belief) => normalizeStatement(belief.statement) === normalizedStatement && sameTopics(belief.topics, normalizedTopics),
      )
      if (mergedMatch) {
        const updated = yield* withAssertion(mergedMatch, input.assertion)
        yield* write(target, replaceBelief(store, updated))
        return { _tag: "merged" as const, id: updated.id, unknownTopics }
      }

      const relatedMatches = current.beliefs.filter(
        (belief) => sameTopics(belief.topics, normalizedTopics) && scopesOverlap(belief.scope, scope),
      )
      if (relatedMatches.length > 0) {
        const created = yield* createBelief(normalizedTopics, scope, input)
        yield* write(target, { ...store, beliefs: [...store.beliefs, created] })
        return { _tag: "related" as const, id: created.id, relatedIds: relatedMatches.map((belief) => belief.id), unknownTopics }
      }

      const refinesMatch = current.beliefs.find(
        (belief) => isStrictSubset(normalizedTopics, belief.topics) || isStrictSubset(belief.topics, normalizedTopics),
      )
      if (refinesMatch) {
        const created = yield* createBelief(normalizedTopics, scope, input)
        const relation = isStrictSubset(normalizedTopics, refinesMatch.topics) ? ("subset" as const) : ("superset" as const)
        yield* write(target, { ...store, beliefs: [...store.beliefs, created] })
        return { _tag: "refines" as const, id: created.id, relation, relatedId: refinesMatch.id, unknownTopics }
      }

      const created = yield* createBelief(normalizedTopics, scope, input)
      yield* write(target, { ...store, beliefs: [...store.beliefs, created] })
      return { _tag: "added" as const, id: created.id, unknownTopics }
    })

    const confirm = Effect.fn("BeliefStore.confirm")(function* (
      target: Target,
      id: BeliefSchema.ID,
      input: { readonly ref: string },
    ) {
      const current = yield* load(target)
      if (typeof current === "symbol") return undefined
      const belief = current.beliefs.find((item) => item.id === id)
      if (!belief) return undefined
      const updated = yield* withAssertion(belief, { by: "owner", how: "confirmed", ref: input.ref })
      yield* write(target, replaceBelief(current, updated))
      return updated
    })

    const reject = Effect.fn("BeliefStore.reject")(function* (
      target: Target,
      id: BeliefSchema.ID,
      input: { readonly ref: string },
    ) {
      const current = yield* load(target)
      if (typeof current === "symbol") return undefined
      const belief = current.beliefs.find((item) => item.id === id)
      if (!belief) return undefined
      const updated = yield* withRejection(belief, input)
      yield* write(target, replaceBelief(current, updated))
      return updated
    })

    return Service.of({ load, write, propose, confirm, reject })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Location.node],
})

function sortBeliefs(store: BeliefSchema.Store): BeliefSchema.Store {
  return {
    ...store,
    beliefs: store.beliefs.toSorted((a, b) => {
      const topic = a.topics[0] === b.topics[0] ? 0 : a.topics[0] < b.topics[0] ? -1 : 1
      return topic !== 0 ? topic : a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    }),
  }
}

function normalizeStatement(statement: string) {
  return statement.trim().toLowerCase().replace(/\s+/g, " ")
}

function sameTopics(a: ReadonlyArray<string>, b: ReadonlyArray<string>) {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((topic) => setB.has(topic))
}

/** `a` is a non-empty, strict subset of `b` (fewer topics, all present in `b`). */
function isStrictSubset(a: ReadonlyArray<string>, b: ReadonlyArray<string>) {
  if (a.length >= b.length) return false
  const setB = new Set(b)
  return a.every((topic) => setB.has(topic))
}

/**
 * Whether two scopes could apply to the same files. Classification uses
 * structure only, so this checks for an identical pattern (or `**`) rather
 * than running a real glob-intersection algorithm.
 */
function scopesOverlap(a: ReadonlyArray<string>, b: ReadonlyArray<string>) {
  if (a.includes("**") || b.includes("**")) return true
  const setB = new Set(b)
  return a.some((pattern) => setB.has(pattern))
}

function unknownVocabulary(vocabulary: ReadonlyArray<BeliefSchema.Topic>, topics: ReadonlyArray<string>) {
  const known = new Set<string>(vocabulary.map(String))
  return topics.filter((topic) => !known.has(topic))
}

function mergeVocabulary(vocabulary: ReadonlyArray<BeliefSchema.Topic>, topics: ReadonlyArray<string>) {
  const merged = new Set<string>(vocabulary.map(String))
  for (const topic of topics) merged.add(topic)
  return Array.from(merged)
    .toSorted()
    .map((topic) => BeliefSchema.Topic.make(topic))
}

/**
 * Whether a belief currently reads as rejected: an owner rejection newer than
 * any owner assertion. Step 4 (`status.ts`) derives the full held/learned/
 * hypothesis/rejected status; this narrower check only needs the rejected
 * case, so it isn't duplicated as a dependency here.
 */
function isRejected(belief: BeliefSchema.Belief) {
  const latestRejection = latest(belief.rejections.map((rejection) => rejection.at))
  if (!latestRejection) return false
  const latestOwnerAssertion = latest(
    belief.assertions.filter((assertion) => assertion.by === "owner").map((assertion) => assertion.at),
  )
  if (!latestOwnerAssertion) return true
  return DateTime.isGreaterThan(latestRejection, latestOwnerAssertion)
}

function latest(dates: ReadonlyArray<DateTime.Utc>) {
  return dates.reduce<DateTime.Utc | undefined>(
    (max, date) => (!max || DateTime.isGreaterThan(date, max) ? date : max),
    undefined,
  )
}
