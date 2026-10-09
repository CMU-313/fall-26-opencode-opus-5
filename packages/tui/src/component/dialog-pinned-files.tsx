import { createMemo } from "solid-js"
import { Pinned } from "@opencode-ai/core/util/pinned"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { runPinCommand } from "./prompt/pin"

export function DialogPinnedFiles(props: { session: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const session = createMemo(() => sync.session.get(props.session))
  const options = createMemo(() =>
    Pinned.list(session()?.metadata).map((file) => ({
      title: file,
      value: file,
      description: "select to unpin",
    })),
  )

  return (
    <DialogSelect
      title="Pinned Files"
      placeholder="Filter pinned files"
      emptyView={<text>No pinned files. Use /pin &lt;path&gt; to pin one.</text>}
      options={options()}
      onSelect={async (option) => {
        const current = session()
        if (!current) return
        const result = await runPinCommand({
          client: sdk.client,
          session: current,
          command: { action: "unpin", path: option.value },
        })
        toast.show({ message: result.message, variant: result.type })
        if (result.type !== "error" && result.files.length === 0) dialog.clear()
      }}
    />
  )
}
