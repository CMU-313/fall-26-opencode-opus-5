import { DialogPrompt } from "../ui/dialog-prompt"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { createMemo } from "solid-js"
import { applySetMaxCost, parseMaxCostInput } from "@opencode-ai/core/session/max-cost-logic"

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
        const parsed = parseMaxCostInput(value)
        if (parsed.kind === "invalid") {
          toast.show({ message: "Enter a positive number", variant: "error" })
          return
        }

        // setMetadata replaces the whole object, so keep the other keys
        const current = session()?.metadata ?? {}
        const currentCost = session()?.cost ?? 0

        if (parsed.kind === "clear") {
          const { maxCost: _drop, ...rest } = current
          void sdk.client.session.update({ sessionID: props.sessionID, metadata: rest })
          toast.show({ message: "Spending limit cleared", variant: "info" })
          dialog.clear()
          return
        }

        const next = applySetMaxCost(current, parsed.amount)
        void sdk.client.session.update({
          sessionID: props.sessionID,
          metadata: { ...current, ...next },
        })

        if (parsed.amount <= currentCost) {
          toast.show({
            message: `Spending limit set to $${parsed.amount}. Already spent $${currentCost.toFixed(2)} — session will halt before its next step.`,
            variant: "warning",
          })
        } else {
          toast.show({ message: `Spending limit set to $${parsed.amount}`, variant: "info" })
        }
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}