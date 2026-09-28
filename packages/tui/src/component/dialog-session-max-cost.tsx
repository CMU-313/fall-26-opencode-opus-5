import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { createMemo } from "solid-js"

interface DialogSessionMaxCostProps {
  sessionID: string
}

export function DialogSessionMaxCost(props: DialogSessionMaxCostProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const session = createMemo(() => sync.session.get(props.sessionID))

  return (
    <DialogPrompt
      title="Session spending limit (USD, blank to clear)"
      value={String(session()?.metadata?.maxCost ?? "")}
      onConfirm={(value) => {
        const text = value.trim()
        const amount = text === "" ? undefined : Number(text)
        if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
          toast.show({ message: "Enter a positive number", variant: "error" })
          return
        }

        // setMetadata replaces the whole object, so keep the other keys
        const { maxCost: _old, ...rest } = session()?.metadata ?? {}
        void sdk.client.session.update({
          sessionID: props.sessionID,
          metadata: amount === undefined ? rest : { ...rest, maxCost: amount },
        })

        toast.show({
          message: amount === undefined ? "Spending limit cleared" : `Spending limit set to $${amount}`,
          variant: "info",
        })
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}