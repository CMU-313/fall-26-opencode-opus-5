import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Token } from "@/util/token"

export {
  METADATA_KEY,
  MAX_TOKENS,
  CONTEXT_SHARE,
  list,
  normalize,
  add,
  remove,
  withFiles,
  limit,
  check,
} from "@opencode-ai/core/util/pinned"
export type { Bounds } from "@opencode-ai/core/util/pinned"

export type Loaded = { path: string; content?: string; tokens: number }

export function render(files: readonly Loaded[], max: number) {
  const lines = [
    "The user has pinned the following files. Their current contents are included on every turn; treat them as already read.",
  ]
  let used = 0
  for (const file of files) {
    if (file.content === undefined) {
      lines.push(`<pinned-file path="${file.path}" missing="true">File could not be read.</pinned-file>`)
      continue
    }
    if (used + file.tokens > max) {
      lines.push(
        `<pinned-file path="${file.path}" omitted="true">Omitted: pinned files exceed the ${max} token limit. Read it with the read tool if needed.</pinned-file>`,
      )
      continue
    }
    used += file.tokens
    lines.push(`<pinned-file path="${file.path}">\n${file.content}\n</pinned-file>`)
  }
  return lines.join("\n")
}

export const load = Effect.fn("SessionPinned.load")(function* (input: { files: readonly string[]; directory: string }) {
  const fsys = yield* FSUtil.Service
  return yield* Effect.forEach(input.files, (file) => {
    const absolute = path.resolve(input.directory, file)
    const relative = path.relative(input.directory, absolute)
    // Only files inside the project may be pinned, even if metadata was set directly.
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return Effect.succeed<Loaded>({ path: file, content: undefined, tokens: 0 })
    }
    return fsys.readFileStringSafe(absolute).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
      Effect.map((content): Loaded => ({ path: file, content, tokens: content ? Token.estimate(content) : 0 })),
    )
  })
})

export * as SessionPinned from "./pinned"
