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

const storeLayer = (input: { config: string; projectDirectory: string; directory?: string }) =>
  AppNodeBuilder.build(LayerNode.group([BeliefStore.node]), [
    [Global.node, Global.layerWith({ config: input.config })],
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location(
            { directory: AbsolutePath.make(input.directory ?? input.projectDirectory) },
            { projectDirectory: AbsolutePath.make(input.projectDirectory) },
          ),
        ),
      ),
    ],
  ])

const withTmp = <E>(body: (tmp: { global: string; project: string }) => Effect.Effect<void, E>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => body({ global: path.join(tmp.path, "global"), project: path.join(tmp.path, "project") })))

const beliefInput = (overrides: { id?: string; topics?: ReadonlyArray<string> } = {}) => ({
  id: overrides.id ?? "bel_test1",
  statement: "Test belief",
  topics: overrides.topics ?? ["comments"],
  scope: ["**"],
  assertions: [{ by: "owner", how: "stated", ref: "msg_1", at: 1700000000000 }],
  rejections: [],
  evidence: [],
})

const decodeStore = (input: unknown) => Schema.decodeUnknownSync(BeliefSchema.Store)(input)

describe("BeliefStore", () => {
  it.live("loads an empty store for both targets when no file exists", () =>
    withTmp(({ global, project }) =>
      BeliefStore.Service.pipe(
        Effect.flatMap((service) =>
          Effect.gen(function* () {
            expect(yield* service.load("project")).toEqual({ version: 1, topics: [], beliefs: [] })
            expect(yield* service.load("personal")).toEqual({ version: 1, topics: [], beliefs: [] })
          }),
        ),
        Effect.provide(storeLayer({ config: global, projectDirectory: project })),
      ),
    ),
  )

  it.live("writes and loads back the project store deterministically", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const store = decodeStore({ version: 1, topics: ["comments", "naming"], beliefs: [beliefInput()] })
        const layer = storeLayer({ config: global, projectDirectory: project })
        yield* BeliefStore.Service.pipe(Effect.flatMap((service) => service.write("project", store)), Effect.provide(layer))

        const file = path.join(project, ".opencode", "beliefs.json")
        const raw = yield* Effect.promise(() => fs.readFile(file, "utf8"))
        expect(raw.endsWith("\n")).toBe(true)
        expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2) + "\n")

        const loaded = yield* BeliefStore.Service.pipe(Effect.flatMap((service) => service.load("project")), Effect.provide(layer))
        expect(loaded).toEqual(store)
      }),
    ),
  )

  it.live("keeps the project and personal stores independent", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const store = decodeStore({ version: 1, topics: ["comments"], beliefs: [beliefInput()] })
        const layer = storeLayer({ config: global, projectDirectory: project })
        yield* BeliefStore.Service.pipe(Effect.flatMap((service) => service.write("project", store)), Effect.provide(layer))
        const personal = yield* BeliefStore.Service.pipe(Effect.flatMap((service) => service.load("personal")), Effect.provide(layer))
        expect(personal).toEqual({ version: 1, topics: [], beliefs: [] })
      }),
    ),
  )

  it.live("sorts written beliefs by first topic then id", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const store = decodeStore({
          version: 1,
          topics: ["naming", "comments"],
          beliefs: [
            beliefInput({ id: "bel_b", topics: ["naming"] }),
            beliefInput({ id: "bel_a", topics: ["comments"] }),
            beliefInput({ id: "bel_c", topics: ["comments"] }),
          ],
        })
        const layer = storeLayer({ config: global, projectDirectory: project })
        yield* BeliefStore.Service.pipe(Effect.flatMap((service) => service.write("project", store)), Effect.provide(layer))
        const loaded = yield* BeliefStore.Service.pipe(Effect.flatMap((service) => service.load("project")), Effect.provide(layer))
        if (typeof loaded === "symbol") throw new Error("expected a store")
        expect(loaded.beliefs.map((belief) => String(belief.id))).toEqual(["bel_a", "bel_c", "bel_b"])
      }),
    ),
  )

  it.live("keeps the project store in the working directory outside a repository", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const store = decodeStore({ version: 1, topics: ["comments"], beliefs: [beliefInput()] })
        yield* BeliefStore.Service.pipe(
          Effect.flatMap((service) => service.write("project", store)),
          Effect.provide(storeLayer({ config: global, projectDirectory: "/", directory: project })),
        )
        expect(yield* Effect.promise(() => Bun.file(path.join(project, ".opencode", "beliefs.json")).exists())).toBe(true)
      }),
    ),
  )

  it.live("reports a malformed store file as unavailable", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const file = path.join(project, ".opencode", "beliefs.json")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(file, "not valid json")
        })
        const loaded = yield* BeliefStore.Service.pipe(
          Effect.flatMap((service) => service.load("project")),
          Effect.provide(storeLayer({ config: global, projectDirectory: project })),
        )
        expect(loaded).toBe(BeliefStore.unavailable)
      }),
    ),
  )

  it.live("never overwrites a malformed file just by loading it", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const file = path.join(project, ".opencode", "beliefs.json")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.writeFile(file, "not valid json")
        })
        yield* BeliefStore.Service.pipe(
          Effect.flatMap((service) => service.load("project")),
          Effect.provide(storeLayer({ config: global, projectDirectory: project })),
        )
        const raw = yield* Effect.promise(() => fs.readFile(file, "utf8"))
        expect(raw).toBe("not valid json")
      }),
    ),
  )

  it.effect("honors the project instruction opt-out for the project store only", () =>
    Effect.gen(function* () {
      const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
      yield* withTmp(({ global, project }) =>
        Effect.gen(function* () {
          const file = path.join(project, ".opencode", "beliefs.json")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, JSON.stringify({ version: 1, topics: ["comments"], beliefs: [beliefInput()] }))
          })
          const loaded = yield* BeliefStore.Service.pipe(
            Effect.flatMap((service) => service.load("project")),
            Effect.provide(storeLayer({ config: global, projectDirectory: project })),
          )
          expect(loaded).toEqual({ version: 1, topics: [], beliefs: [] })
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
            else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
          }),
        ),
      )
    }),
  )
})
