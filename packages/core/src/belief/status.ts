export * as BeliefStatus from "./status"

import { DateTime } from "effect"
import { BeliefSchema } from "./schema"

export type Status = "rejected" | "held" | "learned" | "hypothesis"

const MIN_CORRECTION_SESSIONS = 2
const MIN_ACCEPTANCES_WITH_CORRECTION = 3
const MIN_SESSIONS_FOR_ACCEPTANCE_PATH = 2

/** Derives a belief's status from its assertions, rejections, and evidence. Never stored. */
export function derive(belief: BeliefSchema.Belief): Status {
  if (isRejected(belief)) return "rejected"
  if (belief.assertions.some((assertion) => assertion.by === "owner")) return "held"
  if (isLearned(belief)) return "learned"
  return "hypothesis"
}

function isRejected(belief: BeliefSchema.Belief) {
  const latestRejection = latest(belief.rejections.map((rejection) => rejection.at))
  if (!latestRejection) return false
  const latestOwnerAssertion = latest(
    belief.assertions.filter((assertion) => assertion.by === "owner").map((assertion) => assertion.at),
  )
  if (!latestOwnerAssertion) return true
  return DateTime.isGreaterThan(latestRejection, latestOwnerAssertion)
}

function isLearned(belief: BeliefSchema.Belief) {
  const corrections = belief.evidence.filter((evidence) => evidence.kind === "correction")
  const acceptances = belief.evidence.filter((evidence) => evidence.kind === "acceptance")
  const contradictions = belief.evidence.filter((evidence) => evidence.kind === "contradiction")
  const supporting = [...corrections, ...acceptances]

  const meetsThreshold =
    distinctSessions(corrections).size >= MIN_CORRECTION_SESSIONS ||
    (corrections.length >= 1 &&
      acceptances.length >= MIN_ACCEPTANCES_WITH_CORRECTION &&
      distinctSessions(supporting).size >= MIN_SESSIONS_FOR_ACCEPTANCE_PATH)
  if (!meetsThreshold) return false

  const latestSupporting = latest(supporting.map((evidence) => evidence.at))
  const latestContradiction = latest(contradictions.map((evidence) => evidence.at))
  if (!latestSupporting || !latestContradiction) return true
  return !DateTime.isGreaterThan(latestContradiction, latestSupporting)
}

function distinctSessions(evidence: ReadonlyArray<BeliefSchema.Evidence>) {
  return new Set(evidence.map((item) => String(item.session)))
}

function latest(dates: ReadonlyArray<DateTime.Utc>) {
  return dates.reduce<DateTime.Utc | undefined>(
    (max, date) => (!max || DateTime.isGreaterThan(date, max) ? date : max),
    undefined,
  )
}
