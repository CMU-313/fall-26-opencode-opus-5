export * as BeliefStore from "./store"

import path from "path"
import { Context, Effect, Layer, Option, Schema } from "effect"
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

export interface Interface {
  readonly load: (target: Target) => Effect.Effect<BeliefSchema.Store | Unavailable>
  readonly write: (target: Target, store: BeliefSchema.Store) => Effect.Effect<void, FSUtil.Error>
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

    return Service.of({ load, write })
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
