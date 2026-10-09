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
          typeof loaded === "symbol" ? SystemContext.unavailable : visibleLines(section, loaded),
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

/** Held and learned beliefs from one store, as the lines shown to the model. */
export function visibleLines(section: "project" | "personal", store: BeliefSchema.Store) {
  return store.beliefs
    .filter((belief) => VISIBLE_STATUSES.has(BeliefStatus.derive(belief)))
    .map((belief) => new Line({ section, id: String(belief.id), text: renderLine(belief) }))
}

function renderLine(belief: BeliefSchema.Belief) {
  return `[${belief.topics.join(", ")}] ${belief.statement} (scope: ${belief.scope.join(", ")})`
}

export function render(lines: ReadonlyArray<Line>) {
  return [
    list("Project beliefs (held and learned):", lines.filter((line) => line.section === "project")),
    list("Personal beliefs (held and learned):", lines.filter((line) => line.section === "personal")),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function renderUpdate(previous: ReadonlyArray<Line>, current: ReadonlyArray<Line>) {
  const previousText = new Map(previous.map((line) => [line.id, line.text]))
  const currentIds = new Set(current.map((line) => line.id))
  return [
    list("Beliefs added:", current.filter((line) => !previousText.has(line.id))),
    list("Beliefs changed:", current.filter((line) => previousText.has(line.id) && previousText.get(line.id) !== line.text)),
    list("Beliefs no longer held or learned:", previous.filter((line) => !currentIds.has(line.id))),
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** A titled bullet list, or an empty string when there is nothing to list. */
function list(title: string, lines: ReadonlyArray<Line>) {
  return lines.length === 0 ? "" : [title, ...lines.map((line) => `- ${line.text}`)].join("\n")
}
