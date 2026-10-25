import type { ExtensionHook } from '@pixelsky/protocol'
import { allMessages, tr, type TranslationKey } from '@/i18n/core'
import { Button } from '@/ui'

/** 钩子事件的说法；词典没收录的事件直接显示原名 */
export const hookEvent = (event: string): string => {
  const key = `plugins.hooks.event.${event}` as TranslationKey
  return key in allMessages ? tr(key) : event
}

/** 「会话开始、每条消息发送时」：同一事件只列一次 */
export const hookEvents = (hooks: ExtensionHook[]): string =>
  [...new Set(hooks.map(h => h.event))].map(hookEvent).join(tr('plugins.hooks.separator'))

/** 真正会运行本机命令的钩子（http / prompt / agent 不算） */
export const commandHooks = (hooks: ExtensionHook[] | undefined): ExtensionHook[] =>
  (hooks ?? []).filter(h => h.type === 'command')

/** 打开开关前要不要先提示：只在「启用」且插件带命令钩子时 */
export const needsHookAsk = (on: boolean, hooks: ExtensionHook[] | undefined): boolean =>
  on && commandHooks(hooks).length > 0

/** 启用前的提示：事件加要运行的命令，用户看清了再点「仍然启用」 */
export function HookWarning({
  hooks,
  busy,
  onCancel,
  onConfirm,
}: {
  hooks: ExtensionHook[]
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const commands = commandHooks(hooks)
  return (
    <div role="alert" className="flex w-full flex-wrap items-center gap-2 text-meta text-warn">
      <span className="min-w-0 flex-1 break-words">{tr('plugins.hooks.warn', { events: hookEvents(commands) })}</span>
      <Button variant="ghost" onClick={onCancel}>
        {tr('plugins.hooks.cancel')}
      </Button>
      <Button disabled={busy} onClick={onConfirm}>
        {tr('plugins.hooks.confirm')}
      </Button>
      <pre className="max-h-24 w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-2 text-fg-secondary">
        {commands.map(h => h.command).join('\n')}
      </pre>
    </div>
  )
}

/** 插件详情里的钩子列表：事件、匹配条件、要执行的命令。只展示，不执行 */
export function HookList({ hooks }: { hooks: ExtensionHook[] }) {
  return (
    <div data-extension-hooks className="flex min-w-0 flex-col gap-2">
      <h5 className="text-label text-fg-muted">
        {tr('plugins.hooks.title')} · {hooks.length}
      </h5>
      <p className="text-meta text-fg-muted">{tr('plugins.hooks.note')}</p>
      <ul className="flex flex-col gap-2">
        {hooks.map((h, i) => (
          <li key={i} className="min-w-0 rounded-md bg-subtle p-2.5">
            <p className="break-words text-list">
              {hookEvent(h.event)}
              <span className="text-meta text-fg-faint">
                {' · '}
                {h.matcher ? tr('plugins.hooks.matches') + ' ' + h.matcher : tr('plugins.hooks.always')}
                {h.type !== 'command' ? ' · ' + h.type : ''}
                {h.timeout ? ' · ' + h.timeout + 's' : ''}
              </span>
            </p>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-meta text-fg-secondary">
              {h.command}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  )
}
