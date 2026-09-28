import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import fs from "fs/promises"
import fsSync from "fs"
import os from "os"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BeliefSchema } from "@opencode-ai/core/belief/schema"
import { BeliefStore } from "@opencode-ai/core/belief/store"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { BeliefTool } from "@opencode-ai/core/tool/belief"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "../lib/tool"

const sessionID = SessionV2.ID.make("ses_belief_tool_test")
const tmpRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "opencode-belief-tool-test-"))
const globalDir = path.join(tmpRoot, "global")
const projectDir = path.join(tmpRoot, "project")
const beliefsFile = path.join(projectDir, ".opencode", "beliefs.json")

const assertions: PermissionV2.AssertInput[] = []
let deny = false
let asked = false
let answer: string | "dismiss" | undefined

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const question = Layer.succeed(
  QuestionV2.Service,
  QuestionV2.Service.of({
    ask: () =>
      Effect.sync(() => {
        asked = true
      }).pipe(
        Effect.andThen(
          answer === "dismiss" ? Effect.fail(new QuestionV2.RejectedError()) : Effect.succeed([answer ? [answer] : []]),
        ),
      ),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, BeliefTool.node, BeliefStore.node]), [
    [PermissionV2.node, permission],
    [QuestionV2.node, question],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    [Global.node, Global.layerWith({ config: globalDir })],
    [
      Location.node,
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory: AbsolutePath.make(projectDir) }, { projectDirectory: AbsolutePath.make(projectDir) }),
        ),
      ),
    ],
  ]),
)

const setup = Effect.gen(function* () {
  assertions.length = 0
  deny = false
  asked = false
  answer = undefined
  yield* Effect.promise(() => fs.rm(beliefsFile, { force: true }))
})

const call = (input: unknown, id = "call-belief") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: BeliefTool.name, input },
})

describe("BeliefTool", () => {
  it.effect("confirming Yes holds the belief and asserts permission", () =>
    Effect.gen(function* () {
      yield* setup
      answer = "Yes, that's right"
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain(BeliefTool.name)
      expect(
        yield* settleTool(
          registry,
          call({ statement: "Prefer early returns", topics: ["control-flow"] }, "call-yes"),
        ),
      ).toMatchObject({ output: { structured: { outcome: "added", status: "held" } } })
      expect(assertions).toMatchObject([{ sessionID, action: "belief", resources: ["*"] }])
      expect(asked).toBe(true)
    }),
  )

  it.effect("answering No rejects the belief", () =>
    Effect.gen(function* () {
      yield* setup
      answer = "No"
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ statement: "Prefer early returns", topics: ["control-flow"] }))).toEqual(
        { type: "text", value: JSON.stringify({ outcome: "added", status: "rejected" }, null, 2) },
      )
    }),
  )

  it.effect("Not now leaves the belief as a hypothesis without confirming or rejecting", () =>
    Effect.gen(function* () {
      yield* setup
      answer = "Not now"
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ statement: "Prefer early returns", topics: ["control-flow"] }))).toEqual(
        { type: "text", value: JSON.stringify({ outcome: "added", status: "hypothesis" }, null, 2) },
      )
      const store = yield* BeliefStore.Service
      const loaded = yield* store.load("project")
      if (typeof loaded === "symbol") throw new Error("expected a store")
      const encoded = Schema.encodeSync(BeliefSchema.Belief)(loaded.beliefs[0])
      expect(encoded.assertions).toHaveLength(1)
      expect(encoded.rejections).toHaveLength(0)
    }),
  )

  it.effect("dismissing the question leaves the belief as a hypothesis", () =>
    Effect.gen(function* () {
      yield* setup
      answer = "dismiss"
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ statement: "Prefer early returns", topics: ["control-flow"] }))).toEqual(
        { type: "text", value: JSON.stringify({ outcome: "added", status: "hypothesis" }, null, 2) },
      )
    }),
  )

  it.effect("a rejected match returns without asking the owner", () =>
    Effect.gen(function* () {
      yield* setup
      const store = yield* BeliefStore.Service
      const rejected = { by: "agent" as const, how: "observed" as const, ref: "msg_1", at: 1_700_000_000_000 }
      yield* store.write("project", {
        version: 1,
        topics: [BeliefSchema.Topic.make("imports")],
        beliefs: [
          Schema.decodeUnknownSync(BeliefSchema.Belief)({
            id: "bel_rejected",
            statement: "group imports together",
            topics: ["imports"],
            scope: ["**"],
            assertions: [rejected],
            rejections: [{ by: "owner", ref: "msg_2", at: 1_700_000_100_000 }],
            evidence: [],
          }),
        ],
      })

      const registry = yield* ToolRegistry.Service
      expect(
        yield* executeTool(registry, call({ statement: "Group imports together", topics: ["imports"] })),
      ).toEqual({ type: "text", value: JSON.stringify({ outcome: "rejected", status: "rejected" }, null, 2) })
      expect(asked).toBe(false)
    }),
  )

  it.effect("does not record a belief when permission is denied", () =>
    Effect.gen(function* () {
      yield* setup
      deny = true
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, call({ statement: "Prefer early returns", topics: ["control-flow"] })),
      ).toEqual({ type: "error", value: "Unable to record belief" })
      expect(fsSync.existsSync(beliefsFile)).toBe(false)
      expect(asked).toBe(false)
    }),
  )
})
