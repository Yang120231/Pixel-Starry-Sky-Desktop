import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
// 设置 › 本机引擎 › 详情 › 高级里的「启动」（docs/ui/engine-launch.md §3，参考 Mirasim 的 Launch 卡片）：
// 收起时一行状态（自带程序 / 已替换 / 找不到 / 版本未知），点「修改」后填命令和参数；
// 「完成」先交给引擎宿主校验再保存（找不到、不允许的参数留在编辑状态并显示原因），Esc 放弃修改。
import { Fragment, useState, type KeyboardEvent } from 'react'
import { joinArgs, splitArgs, type EngineConfigPatch, type EngineLocalConfig } from '@pixelsky/protocol'
import { Button, cn } from '@/ui'
import type { EngineLite } from '@/data/types'
import { FIELD } from './parts'

export function LaunchCard({
  engine: e,
  config,
  onSave,
}: {
  engine: EngineLite
  config: EngineLocalConfig
  onSave: (patch: EngineConfigPatch) => Promise<void>
}) {
  useI18n()
  const [editing, setEditing] = useState(false)
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = tr('settings.engines.LaunchCard.title')
  const modified = !!config.path || config.args.length > 0

  const edit = (): void => {
    setCommand(config.path ?? '')
    setArgs(joinArgs(config.args))
    setError(null)
    setEditing(true)
  }
  const cancel = (): void => {
    setEditing(false)
    setError(null)
  }
  const done = async (): Promise<void> => {
    const parsed = splitArgs(args)
    if (!parsed) {
      setError(tr('settings.engines.LaunchCard.unbalancedQuotes'))
      return
    }
    const patch: EngineConfigPatch = {}
    const cmd = command.trim()
    if (cmd !== (config.path ?? '')) patch.path = cmd || null
    if (joinArgs(parsed) !== joinArgs(config.args)) patch.args = parsed
    if (patch.path === undefined && patch.args === undefined) return cancel()
    setSaving(true)
    setError(null)
    try {
      await onSave(patch)
      setEditing(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (!editing || ev.nativeEvent.isComposing) return
    if (ev.key === 'Escape') {
      // 只放弃这张卡片的修改，不关掉设置窗口
      ev.preventDefault()
      ev.stopPropagation()
      cancel()
    } else if (ev.key === 'Enter' && ev.target instanceof HTMLInputElement) {
      ev.preventDefault()
      void done()
    }
  }

  return (
    <div
      data-setting-title={title}
      onKeyDown={onKeyDown}
      className="-mx-2 rounded-md border-t border-line-subtle px-2 py-3.5 first:border-t-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-ui font-medium text-fg">{title}</span>
            {modified && (
              <span className="inline-flex h-5 items-center rounded-full bg-subtle px-2 text-label text-fg-muted">
                {tr('settings.engines.LaunchCard.modified')}
              </span>
            )}
          </div>
          <Status engine={e} config={config} />
          {!editing && config.args.length > 0 && (
            <p className="selectable mt-0.5 truncate text-meta text-fg-faint" title={joinArgs(config.args)}>
              {tr('settings.engines.LaunchCard.extraArgs')} <span className="font-mono">{joinArgs(config.args)}</span>
            </p>
          )}
        </div>
        {editing ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" className="h-8 px-3 text-meta" disabled={saving} onClick={cancel}>
              {tr('settings.engines.LaunchCard.cancel')}
            </Button>
            <Button variant="primary" className="h-8 px-3 text-meta" disabled={saving} onClick={() => void done()}>
              {saving ? tr('settings.engines.LaunchCard.checking') : tr('settings.engines.LaunchCard.done')}
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="h-8 px-3 text-meta" onClick={edit}>
            {tr('settings.engines.LaunchCard.edit')}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-3">
            <label className="min-w-[200px] flex-1">
              <span className="mb-1 block text-meta text-fg-muted">{tr('settings.engines.LaunchCard.command')}</span>
              <input
                autoFocus
                value={command}
                onChange={ev => setCommand(ev.target.value)}
                placeholder={e.id}
                className={cn(FIELD, 'font-mono text-meta')}
                spellCheck={false}
              />
            </label>
            <label className="min-w-[200px] flex-1">
              <span className="mb-1 block text-meta text-fg-muted">{tr('settings.engines.LaunchCard.arguments')}</span>
              <input
                value={args}
                onChange={ev => setArgs(ev.target.value)}
                placeholder="--flag value"
                className={cn(FIELD, 'font-mono text-meta')}
                spellCheck={false}
              />
            </label>
          </div>
          <p className="mt-2 text-meta text-fg-faint">{tr('settings.engines.LaunchCard.note')}</p>
          {error && (
            <p role="alert" className="mt-2 text-meta text-danger">
              {translateMessage(error)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** 第二行：自带程序 / 已替换 · 版本（或版本未知）· 实际路径；替换的命令找不到时红字说明原因 */
function Status({ engine: e, config }: { engine: EngineLite; config: EngineLocalConfig }) {
  useI18n()
  // 旧版远端没有 launch 字段：按有没有填命令判断
  const replaced = e.launch ? e.launch === 'custom' : !!config.path
  if (replaced && e.status === 'missing')
    return (
      <p className="mt-0.5 text-meta text-danger">
        {e.message
          ? translateMessage(e.message)
          : tr('settings.engines.LaunchCard.notFound', { p0: config.path ?? '' })}
      </p>
    )
  const runs = e.status !== 'missing' && e.status !== 'error' && e.status !== 'unsupported'
  const version = e.version
    ? `v${e.version}`
    : replaced && runs
      ? tr('settings.engines.LaunchCard.unknownVersion')
      : null
  const parts: Array<{ text: string; mono?: boolean }> = [
    { text: replaced ? tr('settings.engines.LaunchCard.replaced') : tr('settings.engines.LaunchCard.stock') },
  ]
  if (version) parts.push({ text: version })
  if (e.path) parts.push({ text: e.path, mono: true })
  else if (!replaced) parts.push({ text: tr('settings.engines.EngineDetail.executableNotDetected') })
  return (
    <p className="selectable mt-0.5 truncate text-meta text-fg-muted" title={e.path ?? undefined}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <span className={cn(part.mono && 'font-mono')}>{part.text}</span>
        </Fragment>
      ))}
    </p>
  )
}
