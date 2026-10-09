import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BeliefContext } from "@opencode-ai/core/belief-context"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const contextLayer = (input: { config: string; projectDirectory: string }) =>
  AppNodeBuilder.build(LayerNode.group([SystemContextRegistry.node, BeliefContext.node]), [
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

const held = (id: string, topic: string, scope: ReadonlyArray<string> = ["**"]) => ({
  id,
  statement: `${id} statement`,
  topics: [topic],
  scope,
  assertions: [{ by: "owner", how: "stated", ref: "msg_owner", at: 1_700_000_000_000 }],
  rejections: [],
  evidence: [],
})

const learned = (id: string, topic: string) => ({
  id,
  statement: `${id} statement`,
  topics: [topic],
  scope: ["**"],
  assertions: [{ by: "agent", how: "learned", ref: "msg_agent", at: 1_700_000_100_000 }],
  rejections: [],
  evidence: [
    { kind: "correction", ref: "msg_1", session: "ses_1", at: 1_700_000_000_000 },
    { kind: "correction", ref: "msg_2", session: "ses_2", at: 1_700_000_100_000 },
  ],
})

const hypothesis = (id: string, topic: string) => ({
  id,
  statement: `${id} statement`,
  topics: [topic],
  scope: ["**"],
  assertions: [{ by: "agent", how: "assumed", ref: "msg_agent", at: 1_700_000_000_000 }],
  rejections: [],
  evidence: [],
})

const writeStore = (file: string, store: unknown) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(store))
  })

const withTmp = <E>(body: (tmp: { global: string; project: string }) => Effect.Effect<void, E>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => body({ global: path.join(tmp.path, "global"), project: path.join(tmp.path, "project") })))

const loadContext = (config: string, projectDirectory: string) =>
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((service) => service.load()),
    Effect.provide(contextLayer({ config, projectDirectory })),
  )

describe("BeliefContext", () => {
  it.live("empty project and personal stores render as SystemContext.empty", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const context = yield* loadContext(global, project)
        const initialized = yield* SystemContext.initialize(context)
        expect(initialized.baseline).toBe("")
        expect(initialized.snapshot).toEqual({})
      }),
    ),
  )

  it.live("baseline renders only held and learned beliefs, separated by store", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const projectFile = path.join(project, ".opencode", "beliefs.json")
        const personalFile = path.join(global, "beliefs.json")
        yield* writeStore(projectFile, {
          version: 1,
          topics: ["comments", "control-flow", "naming"],
          beliefs: [held("bel_held", "comments"), learned("bel_learned", "control-flow"), hypothesis("bel_hyp", "naming")],
        })
        yield* writeStore(personalFile, {
          version: 1,
          topics: ["style"],
          beliefs: [held("bel_personal", "style")],
        })

        const context = yield* loadContext(global, project)
        const initialized = yield* SystemContext.initialize(context)
        expect(initialized.baseline).toContain("Project beliefs")
        expect(initialized.baseline).toContain("bel_held statement")
        expect(initialized.baseline).toContain("bel_learned statement")
        expect(initialized.baseline).not.toContain("bel_hyp statement")
        expect(initialized.baseline).toContain("Personal beliefs")
        expect(initialized.baseline).toContain("bel_personal statement")
      }),
    ),
  )

  it.live("updates report only added, changed, and removed lines", () =>
    withTmp(({ global, project }) =>
      Effect.gen(function* () {
        const projectFile = path.join(project, ".opencode", "beliefs.json")
        yield* writeStore(projectFile, {
          version: 1,
          topics: ["comments"],
          beliefs: [held("bel_held", "comments", ["**"])],
        })
        const initialized = yield* SystemContext.initialize(yield* loadContext(global, project))

        yield* writeStore(projectFile, {
          version: 1,
          topics: ["comments", "control-flow"],
          beliefs: [held("bel_held", "comments", ["packages/core/**"]), learned("bel_learned", "control-flow")],
        })
        const afterChange = yield* SystemContext.reconcile(yield* loadContext(global, project), initialized.snapshot)
        expect(afterChange._tag).toBe("Updated")
        if (afterChange._tag !== "Updated") throw new Error("expected Updated")
        expect(afterChange.text).toContain("Beliefs added:")
        expect(afterChange.text).toContain("bel_learned statement")
        expect(afterChange.text).toContain("Beliefs changed:")
        expect(afterChange.text).toContain("packages/core/**")
        expect(afterChange.text).not.toContain("Beliefs no longer held or learned:")

        yield* writeStore(projectFile, {
          version: 1,
          topics: ["control-flow"],
          beliefs: [learned("bel_learned", "control-flow")],
        })
        const afterRemoval = yield* SystemContext.reconcile(yield* loadContext(global, project), afterChange.snapshot)
        expect(afterRemoval._tag).toBe("Updated")
        if (afterRemoval._tag !== "Updated") throw new Error("expected Updated")
        expect(afterRemoval.text).toContain("Beliefs no longer held or learned:")
        expect(afterRemoval.text).toContain("bel_held statement")
        expect(afterRemoval.text).not.toContain("Beliefs added:")
        expect(afterRemoval.text).not.toContain("Beliefs changed:")
      }),
    ),
  )

  it.effect("preserves admitted beliefs while a store is unavailable", () =>
    Effect.gen(function* () {
      const failingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({ ...fs, readFileStringSafe: () => Effect.fail(new FSUtil.FileSystemError({ method: "read" })) }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([SystemContextRegistry.node, BeliefContext.node]), [
            [Global.node, Global.layerWith({ config: "/global" })],
            [FSUtil.node, failingFS],
            [
              Location.node,
              Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/repo") }))),
            ],
          ]),
        ),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/beliefs": {
            value: [{ section: "project", id: "bel_held", text: "[comments] old (scope: **)" }],
            removed: "Beliefs are no longer being tracked.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )
})
