import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import fs from "fs/promises"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BeliefSchema } from "@opencode-ai/core/belief/schema"
import { BeliefStore } from "@opencode-ai/core/belief/store"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const storeLayer = (input: { config: string; projectDirectory: string }) =>
  AppNodeBuilder.build(LayerNode.group([BeliefStore.node]), [
    [Global.node, Global.layerWith({ config: input.config })],
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(
            { directory: AbsolutePath.make(input.projectDirectory) },
            { projectDirectory: AbsolutePath.make(input.projectDirectory) },
          ),
        ),
      ),
    ],
  ])

const withStore = <E>(body: (service: BeliefStore.Interface) => Effect.Effect<void, E>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((tmp) =>
      BeliefStore.Service.pipe(
        Effect.flatMap(body),
        Effect.provide(
          storeLayer({ config: path.join(tmp.path, "global"), projectDirectory: path.join(tmp.path, "project") }),
        ),
      ),
    ),
  )

const agentAssertion = (ref: string) => ({ by: "agent" as const, how: "assumed" as const, ref })

describe("BeliefStore.propose", () => {
  it.live("adds a new belief and its topic to the vocabulary", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const outcome = yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_1"),
        })
        expect(outcome._tag).toBe("added")

        const loaded = yield* store.load("project")
        if (typeof loaded === "symbol") throw new Error("expected a store")
        expect(loaded.beliefs).toHaveLength(1)
        expect(loaded.topics.map(String)).toEqual(["control-flow"])
      }),
    ),
  )

  it.live("re-proposing the same statement and topics merges instead of duplicating", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const first = yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_1"),
        })
        expect(first._tag).toBe("added")
        const id = first._tag === "added" ? first.id : undefined

        const second = yield* store.propose("project", {
          statement: "  Prefer EARLY returns  ",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_2"),
        })
        expect(second).toMatchObject({ _tag: "merged", id })

        const loaded = yield* store.load("project")
        if (typeof loaded === "symbol") throw new Error("expected a store")
        expect(loaded.beliefs).toHaveLength(1)
        expect(Schema.encodeSync(BeliefSchema.Belief)(loaded.beliefs[0]).assertions).toHaveLength(1)
        expect(Schema.encodeSync(BeliefSchema.Belief)(loaded.beliefs[0]).assertions[0].ref).toBe("msg_2")
      }),
    ),
  )

  it.live("merging as agent never removes or overrides an existing owner assertion", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: { by: "owner", how: "stated", ref: "msg_owner" },
        })
        yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_agent"),
        })
        const loaded = yield* store.load("project")
        if (typeof loaded === "symbol") throw new Error("expected a store")
        const encoded = Schema.encodeSync(BeliefSchema.Belief)(loaded.beliefs[0])
        expect(encoded.assertions).toHaveLength(2)
        expect(encoded.assertions.find((assertion) => assertion.by === "owner")?.ref).toBe("msg_owner")
        expect(encoded.assertions.find((assertion) => assertion.by === "agent")?.ref).toBe("msg_agent")
      }),
    ),
  )

  it.live("same topics with a different statement is kept as related, not merged", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const first = yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_1"),
        })
        if (first._tag !== "added") throw new Error("expected added")

        const second = yield* store.propose("project", {
          statement: "Avoid nested conditionals",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_2"),
        })
        expect(second).toMatchObject({ _tag: "related", relatedIds: [first.id] })

        const loaded = yield* store.load("project")
        if (typeof loaded === "symbol") throw new Error("expected a store")
        expect(loaded.beliefs).toHaveLength(2)
      }),
    ),
  )

  it.live("a rejected belief is not re-added when proposed again", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const rejected = Schema.decodeUnknownSync(BeliefSchema.Belief)({
          id: "bel_rejected",
          statement: "group third-party imports separately",
          topics: ["imports"],
          scope: ["**"],
          assertions: [{ by: "agent", how: "observed", ref: "msg_1", at: 1700000000000 }],
          rejections: [{ by: "owner", ref: "msg_2", at: 1700000100000 }],
          evidence: [],
        })
        yield* store.write("project", { version: 1, topics: [BeliefSchema.Topic.make("imports")], beliefs: [rejected] })

        const outcome = yield* store.propose("project", {
          statement: "Group third-party imports separately",
          topics: ["imports"],
          assertion: agentAssertion("msg_3"),
        })
        expect(outcome._tag).toBe("rejected")

        const loaded = yield* store.load("project")
        if (typeof loaded === "symbol") throw new Error("expected a store")
        expect(loaded.beliefs).toHaveLength(1)
      }),
    ),
  )

  it.live("never writes when the target file is malformed", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          const file = path.join(project, ".opencode", "beliefs.json")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, "not valid json")
          })
          const layer = storeLayer({ config: global, projectDirectory: project })
          const outcome = yield* BeliefStore.Service.pipe(
            Effect.flatMap((service) =>
              service.propose("project", {
                statement: "Anything",
                topics: ["comments"],
                assertion: agentAssertion("msg_1"),
              }),
            ),
            Effect.provide(layer),
          )
          expect(outcome._tag).toBe("unavailable")
          const raw = yield* Effect.promise(() => fs.readFile(file, "utf8"))
          expect(raw).toBe("not valid json")
        }),
      ),
    ),
  )
})

describe("BeliefStore.confirm / reject", () => {
  it.live("confirm adds an owner assertion without disturbing the agent's", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const proposed = yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_1"),
        })
        if (proposed._tag !== "added") throw new Error("expected added")

        const confirmed = yield* store.confirm("project", proposed.id, { ref: "msg_2" })
        if (!confirmed) throw new Error("expected a belief")
        const encoded = Schema.encodeSync(BeliefSchema.Belief)(confirmed)
        expect(encoded.assertions).toHaveLength(2)
        expect(encoded.assertions.find((assertion) => assertion.by === "owner")).toMatchObject({
          how: "confirmed",
          ref: "msg_2",
        })
        expect(encoded.assertions.find((assertion) => assertion.by === "agent")?.ref).toBe("msg_1")
      }),
    ),
  )

  it.live("reject records an owner rejection without removing the agent's assertion", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const proposed = yield* store.propose("project", {
          statement: "Prefer early returns",
          topics: ["control-flow"],
          assertion: agentAssertion("msg_1"),
        })
        if (proposed._tag !== "added") throw new Error("expected added")

        const rejected = yield* store.reject("project", proposed.id, { ref: "msg_2" })
        if (!rejected) throw new Error("expected a belief")
        const encoded = Schema.encodeSync(BeliefSchema.Belief)(rejected)
        expect(encoded.rejections).toHaveLength(1)
        expect(encoded.assertions.find((assertion) => assertion.by === "agent")?.ref).toBe("msg_1")
      }),
    ),
  )

  it.live("confirming an unknown id is a no-op", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const result = yield* store.confirm("project", BeliefSchema.ID.make("bel_missing"), { ref: "msg_1" })
        expect(result).toBeUndefined()
      }),
    ),
  )
})
