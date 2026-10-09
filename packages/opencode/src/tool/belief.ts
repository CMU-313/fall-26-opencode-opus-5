import { Effect } from "effect"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { BeliefTool as CoreBeliefTool } from "@opencode-ai/core/tool/belief"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import * as Tool from "./tool"

type Metadata = {
  outcome: string
  status: string
}

// Legacy-session adapter: the belief logic lives in Core and is shared with the V2 tool.
export const BeliefTool = Tool.define<typeof CoreBeliefTool.Input, Metadata, Question.Service | LocationServiceMap.Service>(
  CoreBeliefTool.name,
  Effect.gen(function* () {
    const question = yield* Question.Service
    const locations = yield* LocationServiceMap.Service

    return {
      description: CoreBeliefTool.description,
      parameters: CoreBeliefTool.Input,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const result = yield* CoreBeliefTool.record(params, ctx.messageID, (prompt) =>
            question
              .ask({
                sessionID: ctx.sessionID,
                questions: [prompt],
                tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
              })
              .pipe(
                Effect.map((answers) => answers[0]?.[0]),
                Effect.catchTag("QuestionRejectedError", () => Effect.succeed(undefined)),
              ),
          ).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(instance.directory) }))))

          return {
            title: `Belief ${result.status}`,
            output: CoreBeliefTool.toModelOutput(result),
            metadata: result,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
