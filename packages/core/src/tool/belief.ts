export * as BeliefTool from "./belief"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { BeliefStatus } from "../belief/status"
import { BeliefStore } from "../belief/store"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "belief"

export const description = `Record a working assumption about the code owner's taste in an area the repository cannot answer: comment style, formatting and naming taste, or design priorities. Do not use this for documented facts (test commands, structure, environment) - those are not beliefs.

The owner is asked to confirm, reject, or defer the belief before it is held or rejected; until then it stays a hypothesis.`

export const Input = Schema.Struct({
  statement: Schema.String.annotate({ description: "The working assumption, stated plainly" }),
  topics: Schema.Array(Schema.String).annotate({ description: "Topics this belief applies to, e.g. comments, naming" }),
  scope: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description: "Path globs this belief applies to (default: everywhere)",
  }),
  store: Schema.Literals(["project", "personal"]).pipe(Schema.optional).annotate({
    description: "Where to record it: project (shared, committed) or personal (default: project)",
  }),
})

export const Output = Schema.Struct({
  outcome: Schema.String,
  status: Schema.String,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output, null, 2)

const confirmQuestion = (statement: string) => ({
  question: `I believe: "${statement}". Is that right?`,
  header: "Confirm belief",
  custom: false,
  options: [
    { label: "Yes, that's right", description: "Confirm this belief" },
    { label: "No", description: "Reject this belief" },
    { label: "Not now", description: "Leave it as a hypothesis for now" },
  ],
})

/**
 * Proposes a belief as an agent assumption, asks the owner to confirm or reject it, and records the answer.
 * Shared by the V2 tool below and the legacy session tool so both runtimes behave the same.
 */
export const record = Effect.fn("BeliefTool.record")(function* (
  input: typeof Input.Type,
  ref: string,
  ask: (prompt: ReturnType<typeof confirmQuestion>) => Effect.Effect<string | undefined>,
) {
  const store = yield* BeliefStore.Service
  const target = input.store ?? "project"
  const outcome = yield* store.propose(target, {
    statement: input.statement,
    topics: input.topics,
    scope: input.scope,
    assertion: { by: "agent", how: "assumed", ref },
  })
  if (outcome._tag === "rejected" || outcome._tag === "unavailable") return { outcome: outcome._tag, status: outcome._tag }

  const label = yield* ask(confirmQuestion(input.statement))
  if (label === "Yes, that's right") yield* store.confirm(target, outcome.id, { ref })
  if (label === "No") yield* store.reject(target, outcome.id, { ref })

  const loaded = yield* store.load(target)
  const belief = typeof loaded === "symbol" ? undefined : loaded.beliefs.find((item) => item.id === outcome.id)
  return { outcome: outcome._tag, status: belief ? BeliefStatus.derive(belief) : "hypothesis" }
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const store = yield* BeliefStore.Service
    const question = yield* QuestionV2.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              return yield* record(input, context.assistantMessageID, (prompt) =>
                question
                  .ask({
                    sessionID: context.sessionID,
                    questions: [prompt],
                    tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                  })
                  .pipe(
                    Effect.map((answers) => answers[0]?.[0]),
                    Effect.catchTag("QuestionV2.RejectedError", () => Effect.succeed(undefined)),
                  ),
              ).pipe(Effect.provideService(BeliefStore.Service, store))
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to record belief" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/belief",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node, BeliefStore.node],
})
