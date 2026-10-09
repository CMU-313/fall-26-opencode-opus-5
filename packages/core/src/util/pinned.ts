import path from "path"

// Pinned files are stored on session metadata so they persist for the life of the
// session without a schema migration. Paths are kept relative to the project directory.
export const METADATA_KEY = "pinnedFiles"

// Upper bound on pinned content, regardless of model size.
export const MAX_TOKENS = 50_000
// Share of the model context window that pinned files may use.
export const CONTEXT_SHARE = 0.25

export type Bounds = { ok: boolean; tokens: number; limit: number }

export function list(metadata: Record<string, unknown> | undefined): string[] {
  const value = metadata?.[METADATA_KEY]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

export function normalize(file: string) {
  const trimmed = file.trim().replace(/^@/, "")
  return path.posix.normalize(trimmed.split(path.sep).join("/")).replace(/^\.\//, "")
}

export function add(files: readonly string[], file: string): string[] {
  const next = normalize(file)
  if (!next || next === ".") return [...files]
  if (files.includes(next)) return [...files]
  return [...files, next]
}

export function remove(files: readonly string[], file: string): string[] {
  const target = normalize(file)
  return files.filter((item) => item !== target)
}

export function withFiles(
  metadata: Record<string, unknown> | undefined,
  files: readonly string[],
): Record<string, unknown> {
  return { ...metadata, [METADATA_KEY]: [...files] }
}

export function limit(model?: { limit: { context: number } }) {
  const context = model?.limit.context ?? 0
  if (context <= 0) return MAX_TOKENS
  return Math.min(MAX_TOKENS, Math.floor(context * CONTEXT_SHARE))
}

export function check(tokens: number, max: number): Bounds {
  return { ok: tokens <= max, tokens, limit: max }
}

export * as Pinned from "./pinned"
