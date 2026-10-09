import path from "path"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2"
import { Pinned } from "@opencode-ai/core/util/pinned"
import { Token } from "@opencode-ai/core/util/token"

export type PinCommand = { action: "pin" | "unpin"; path: string }

export type PinResult =
  | { type: "error"; message: string }
  | { type: "warning"; message: string; files: string[] }
  | { type: "success"; message: string; files: string[] }

// Parses `/pin <path>` and `/unpin <path>`. Returns undefined for any other input so
// the prompt falls through to its normal command handling.
export function parsePinCommand(input: string): PinCommand | undefined {
  const match = input.trim().match(/^\/(pin|unpin)(?:\s+([\s\S]*))?$/)
  if (!match) return undefined
  return { action: match[1] as PinCommand["action"], path: (match[2] ?? "").trim() }
}

async function isFile(client: OpencodeClient, file: string) {
  const dir = path.posix.dirname(file)
  const res = await client.file.list({ path: dir === "." ? "" : dir })
  if (res.error || !res.data) return false
  const name = path.posix.basename(file)
  return res.data.some((item) => item.name === name && item.type === "file")
}

async function tokens(client: OpencodeClient, files: readonly string[]) {
  const sizes = await Promise.all(
    files.map(async (file) => {
      const res = await client.file.read({ path: file })
      return res.data?.type === "text" ? Token.estimate(res.data.content) : 0
    }),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

export async function runPinCommand(input: {
  client: OpencodeClient
  session: Session
  command: PinCommand
  model?: { limit: { context: number } }
}): Promise<PinResult> {
  const { client, session, command } = input
  const usage = `Usage: /${command.action} <path>`
  if (!command.path) return { type: "error", message: usage }

  const file = Pinned.normalize(command.path)
  const current = Pinned.list(session.metadata)

  if (command.action === "unpin") {
    if (!current.includes(file)) return { type: "error", message: `${file} is not pinned` }
    const files = Pinned.remove(current, file)
    const res = await client.session.update({
      sessionID: session.id,
      metadata: Pinned.withFiles(session.metadata, files),
    })
    if (res.error) return { type: "error", message: `Failed to unpin ${file}` }
    return { type: "success", message: `Unpinned ${file}`, files }
  }

  if (file.startsWith("../") || path.isAbsolute(file)) {
    return { type: "error", message: `${file} is outside the project` }
  }
  if (current.includes(file)) return { type: "error", message: `${file} is already pinned` }
  if (!(await isFile(input.client, file))) return { type: "error", message: `${file} is not a file in this project` }

  const files = Pinned.add(current, file)
  const bounds = Pinned.check(await tokens(client, files), Pinned.limit(input.model))
  if (!bounds.ok) {
    return {
      type: "error",
      message: `Not pinned: pinned files would use ~${bounds.tokens.toLocaleString()} tokens, over the ${bounds.limit.toLocaleString()} token limit for this model`,
    }
  }

  const res = await client.session.update({
    sessionID: session.id,
    metadata: Pinned.withFiles(session.metadata, files),
  })
  if (res.error) return { type: "error", message: `Failed to pin ${file}` }
  if (bounds.tokens > bounds.limit * 0.8) {
    return {
      type: "warning",
      message: `Pinned ${file}. Pinned files use ~${bounds.tokens.toLocaleString()} of ${bounds.limit.toLocaleString()} tokens`,
      files,
    }
  }
  return { type: "success", message: `Pinned ${file}`, files }
}
