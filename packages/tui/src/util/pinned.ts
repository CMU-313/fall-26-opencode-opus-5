import { Pinned } from "@opencode-ai/core/util/pinned"

// Sort only the presentation: stored order also controls model-context budgeting.
export function pinnedPaths(metadata: Record<string, unknown> | undefined) {
  return Pinned.list(metadata).sort()
}
