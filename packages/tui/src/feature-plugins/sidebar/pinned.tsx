import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show } from "solid-js"
import { Pinned } from "@opencode-ai/core/util/pinned"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-pinned"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => Pinned.list(props.api.state.session.get(props.session_id)?.metadata))

  return (
    <Show when={list().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Pinned Files</b>
        </text>
        <For each={list()}>
          {(file) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme().accent} flexShrink={0}>
                ◆
              </text>
              <text fg={theme().textMuted} wrapMode="none">
                {Locale.truncateLeft(file, 34)}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 450,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
