export * as BeliefStore from "./store"

import path from "path"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Flag } from "../flag/flag"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Location } from "../location"
import { BeliefSchema } from "./schema"
import { BeliefStatus } from "./status"

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
  | { readonly _tag: "unavailable" }
  | { readonly _tag: "rejected" }
  | { readonly _tag: "added"; readonly id: BeliefSchema.ID }
  | { readonly _tag: "merged"; readonly id: BeliefSchema.ID }
  | { readonly _tag: "related"; readonly id: BeliefSchema.ID; readonly relatedIds: ReadonlyArray<BeliefSchema.ID> }

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

    // Outside a repository the project resolves to the filesystem root, so keep project beliefs with the working directory.
    const projectDirectory =
      path.dirname(location.project.directory) === location.project.directory ? location.directory : location.project.directory
    const filePath = (target: Target) =>
      target === "personal"
        ? path.join(global.config, "beliefs.json")
        : path.join(projectDirectory, ".opencode", "beliefs.json")

    const load = (target: Target) =>
      Effect.gen(function* () {
        if (target === "project" && Flag.OPENCODE_DISABLE_PROJECT_CONFIG) return empty
        const text = yield* fs.readFileStringSafe(filePath(target))
        if (text === undefined) return empty
        return Option.getOrElse(
          Schema.decodeUnknownOption(Schema.fromJsonString(BeliefSchema.Store))(text),
          (): Unavailable => unavailable,
        )
      }).pipe(
        Effect.catch(() => Effect.succeed(unavailable)),
        Effect.catchDefect(() => Effect.succeed(unavailable)),
        Effect.withSpan("BeliefStore.load"),
      )

    const write = Effect.fn("BeliefStore.write")(function* (target: Target, store: BeliefSchema.Store) {
      // Sorted, pretty-printed output keeps the committed file stable and reviewable in a PR diff.
      const beliefs = store.beliefs.toSorted((a, b) => a.topics[0].localeCompare(b.topics[0]) || a.id.localeCompare(b.id))
      const content = JSON.stringify(Schema.encodeSync(BeliefSchema.Store)({ ...store, beliefs }), null, 2) + "\n"
      yield* fs.writeWithDirs(filePath(target), content)
    })

    const propose = Effect.fn("BeliefStore.propose")(function* (target: Target, input: ProposeInput) {
      const current = yield* load(target)
      if (typeof current === "symbol") return { _tag: "unavailable" as const }
      const topics = input.topics.map(BeliefSchema.normalizeTopic)
      const statement = normalizeStatement(input.statement)
      const now = yield* DateTime.now
      const store = {
        ...current,
        topics: [...new Set([...current.topics, ...topics])].toSorted().map((topic) => BeliefSchema.Topic.make(topic)),
      }

      const existing = current.beliefs.find(
        (belief) => normalizeStatement(belief.statement) === statement && sameTopics(belief.topics, topics),
      )
      if (existing && BeliefStatus.derive(existing) === "rejected") return { _tag: "rejected" as const }
      if (existing) {
        yield* write(target, replace(store, withAssertion(existing, { ...input.assertion, at: now })))
        return { _tag: "merged" as const, id: existing.id }
      }

      const created = Schema.decodeUnknownSync(BeliefSchema.Belief)({
        id: BeliefSchema.ID.create(),
        statement: input.statement.trim(),
        topics,
        scope: input.scope ?? ["**"],
        assertions: [{ ...input.assertion, at: DateTime.toEpochMillis(now) }],
        rejections: [],
        evidence: [],
      })
      yield* write(target, { ...store, beliefs: [...store.beliefs, created] })
      const relatedIds = current.beliefs.filter((belief) => sameTopics(belief.topics, topics)).map((belief) => belief.id)
      if (relatedIds.length > 0) return { _tag: "related" as const, id: created.id, relatedIds }
      return { _tag: "added" as const, id: created.id }
    })

    /** Applies an owner answer to one belief. Returns undefined when the store is unavailable or the id is unknown. */
    const answer = (update: (belief: BeliefSchema.Belief, at: DateTime.Utc) => BeliefSchema.Belief) =>
      Effect.fn("BeliefStore.answer")(function* (target: Target, id: BeliefSchema.ID, input: { readonly ref: string }) {
        const current = yield* load(target)
        if (typeof current === "symbol") return undefined
        const belief = current.beliefs.find((item) => item.id === id)
        if (!belief) return undefined
        const updated = update(belief, yield* DateTime.now)
        yield* write(target, replace(current, updated))
        return updated
      })

    const confirm = (target: Target, id: BeliefSchema.ID, input: { readonly ref: string }) =>
      answer((belief, at) => withAssertion(belief, { by: "owner", how: "confirmed", ref: input.ref, at }))(target, id, input)

    const reject = (target: Target, id: BeliefSchema.ID, input: { readonly ref: string }) =>
      answer((belief, at) => ({ ...belief, rejections: [...belief.rejections, { by: "owner", ref: input.ref, at }] }))(
        target,
        id,
        input,
      )

    return Service.of({ load, write, propose, confirm, reject })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Location.node],
})

/** Replaces the participant's previous assertion, so an agent re-proposal never removes the owner's. */
function withAssertion(belief: BeliefSchema.Belief, assertion: BeliefSchema.Assertion): BeliefSchema.Belief {
  return { ...belief, assertions: [assertion, ...belief.assertions.filter((existing) => existing.by !== assertion.by)] }
}

function replace(store: BeliefSchema.Store, updated: BeliefSchema.Belief): BeliefSchema.Store {
  return { ...store, beliefs: store.beliefs.map((belief) => (belief.id === updated.id ? updated : belief)) }
}

function normalizeStatement(statement: string) {
  return statement.trim().toLowerCase().replace(/\s+/g, " ")
}

function sameTopics(a: ReadonlyArray<string>, b: ReadonlyArray<string>) {
  return a.length === b.length && a.every((topic) => b.includes(topic))
}
