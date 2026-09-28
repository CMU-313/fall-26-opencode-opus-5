export * as BeliefContext from "./belief-context"

import { Effect, Layer, Schema } from "effect"
import { BeliefSchema } from "./belief/schema"
import { BeliefStatus } from "./belief/status"
import { BeliefStore } from "./belief/store"
import { makeLocationNode } from "./effect/app-node"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"

const VISIBLE_STATUSES = new Set<BeliefStatus.Status>(["held", "learned"])

class Line extends Schema.Class<Line>("BeliefContext.Line")({
  section: Schema.Literals(["project", "personal"]),
  id: Schema.String,
  text: Schema.String,
}) {}

const Lines = Schema.Array(Line)
const key = SystemContext.Key.make("core/beliefs")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BeliefStore.Service
    const registry = yield* SystemContextRegistry.Service

    const source = (value: ReadonlyArray<Line> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Lines),
        load: Effect.succeed(value),
        baseline: render,
        update: renderUpdate,
        removed: () => "Beliefs are no longer being tracked.",
      })

    const linesFor = (section: "project" | "personal") =>
      store.load(section).pipe(
        Effect.map((loaded): ReadonlyArray<Line> | SystemContext.Unavailable =>
          typeof loaded === "symbol"
            ? SystemContext.unavailable
            : loaded.beliefs
                .filter((belief) => VISIBLE_STATUSES.has(BeliefStatus.derive(belief)))
                .map((belief) => new Line({ section, id: String(belief.id), text: renderLine(belief) })),
        ),
      )

    const observe = Effect.fn("BeliefContext.observe")(function* () {
      const [project, personal] = yield* Effect.all([linesFor("project"), linesFor("personal")])
      if (project === SystemContext.unavailable || personal === SystemContext.unavailable) return SystemContext.unavailable
      return [...project, ...personal]
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((lines) =>
          lines === SystemContext.unavailable ? source(lines) : lines.length === 0 ? SystemContext.empty : source(lines),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "belief-context",
  layer,
  deps: [BeliefStore.node, SystemContextRegistry.node],
})

function renderLine(belief: BeliefSchema.Belief) {
  const topics = belief.topics.map(String).join(", ")
  const scope = belief.scope.join(", ")
  return `[${topics}] ${belief.statement} (scope: ${scope})`
}

function sectionsOf(lines: ReadonlyArray<Line>) {
  return (["project", "personal"] as const)
    .map((section) => [section, lines.filter((line) => line.section === section)] as const)
    .filter(([, items]) => items.length > 0)
}

function renderSection(section: "project" | "personal", items: ReadonlyArray<Line>) {
  const title = section === "project" ? "Project beliefs (held and learned)" : "Personal beliefs (held and learned)"
  return [title, ...items.map((line) => `- ${line.text}`)].join("\n")
}

function render(lines: ReadonlyArray<Line>) {
  return sectionsOf(lines)
    .map(([section, items]) => renderSection(section, items))
    .join("\n\n")
}

function renderUpdate(previous: ReadonlyArray<Line>, current: ReadonlyArray<Line>) {
  const previousById = new Map(previous.map((line) => [line.id, line]))
  const currentById = new Map(current.map((line) => [line.id, line]))
  const added = current.filter((line) => !previousById.has(line.id))
  const changed = current.filter((line) => {
    const prior = previousById.get(line.id)
    return prior !== undefined && prior.text !== line.text
  })
  const removed = previous.filter((line) => !currentById.has(line.id))

  return [
    added.length > 0 ? ["Beliefs added:", ...added.map((line) => `- ${line.text}`)].join("\n") : undefined,
    changed.length > 0 ? ["Beliefs changed:", ...changed.map((line) => `- ${line.text}`)].join("\n") : undefined,
    removed.length > 0 ? ["Beliefs no longer held or learned:", ...removed.map((line) => `- ${line.text}`)].join("\n") : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n")
}
