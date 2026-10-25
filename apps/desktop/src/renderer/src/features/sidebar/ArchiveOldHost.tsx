import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Segmented, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Select } from '@/ui/Select'
import { Toast } from '@/ui/Toast'
import { useI18n } from '@/i18n/I18nProvider'
import { useEngineState } from '@/features/engine'
import { usePaneState } from '@/features/panes/store'
import { useChannels } from '@/features/channels/store'
import { useDemoSessionChanges } from '@/data/demo'
import { DEFAULT_DAYS, PRESET_DAYS, idleLabel, parseDays, planArchive, type ArchiveItem } from './archiveOld'
import {
  archiveBatch,
  archiveScopes,
  closeArchiveOld,
  collectArchiveItems,
  restoreBatch,
  useArchiveOldRequest,
} from './archiveOldData'

type Preset = `${(typeof PRESET_DAYS)[number]}` | 'custom'
const ALL = '*'

/**
 * 批量归档旧会话（docs/ui/archive-old-sessions.md）：项目菜单、侧栏项目区菜单打开；
 * 对话框关掉后这里还留着「已归档 N 个会话 · 撤销」的提示，所以挂在应用根上。
 */
export function ArchiveOldHost() {
  const { t } = useI18n()
  const request = useArchiveOldRequest()
  const [toast, setToast] = useState<{ text: string; undo?: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(timer)
  }, [toast])
  const undo = async (ids: string[]): Promise<void> => {
    setBusy(true)
    const { done, failed } = await restoreBatch(ids)
    setBusy(false)
    setToast({
      text: failed.length
        ? t('archiveOld.undoFailed', { count: failed.length })
        : t('archiveOld.undone', { count: done.length }),
    })
  }
  return (
    <>
      {request && (
        <ArchiveOldDialog
          initialScope={request.projectId ?? ALL}
          onArchived={ids => setToast({ text: t('archiveOld.toast', { count: ids.length }), undo: ids })}
        />
      )}
      {toast && (
        <Toast data-archive-toast className="py-2.5 text-list">
          <span className="min-w-0 break-words">{toast.text}</span>
          {toast.undo && (
            <button
              disabled={busy}
              className="shrink-0 text-accent-fg underline"
              onClick={() => void undo(toast.undo!)}
            >
              {t('session.undo')}
            </button>
          )}
          <button
            aria-label={t('session.dismiss')}
            onClick={() => setToast(null)}
            className="shrink-0 rounded-sm p-1 text-fg-muted hover:bg-hover"
          >
            <X size={14} />
          </button>
        </Toast>
      )}
    </>
  )
}

function ArchiveOldDialog({ initialScope, onArchived }: { initialScope: string; onArchived: (ids: string[]) => void }) {
  const { t } = useI18n()
  const [preset, setPreset] = useState<Preset>(`${DEFAULT_DAYS}` as Preset),
    [custom, setCustom] = useState(''),
    [scope, setScope] = useState(initialScope),
    // 默认全选：只记下被取消勾选的
    [off, setOff] = useState<ReadonlySet<string>>(new Set()),
    [progress, setProgress] = useState<{ done: number; total: number } | null>(null),
    [failed, setFailed] = useState<Array<{ id: string; title: string; message: string }>>([])
  // 这些变了就重新收集：会话列表、窗格里开着的、频道绑定、演示模式的改动
  const sessions = useEngineState(s => s.sessions),
    projects = useEngineState(s => s.projects),
    layout = usePaneState(s => s.layout),
    bindings = useChannels(s => s.sessionBindings),
    changes = useDemoSessionChanges()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => collectArchiveItems(), [sessions, layout, bindings, changes])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scopes = useMemo(() => archiveScopes(), [projects])
  const days = preset === 'custom' ? parseDays(custom) : Number(preset)
  const plan = useMemo(
    () =>
      days === null
        ? { pick: [], skip: [] }
        : planArchive(items, { days, projectId: scope === ALL ? null : scope, now: Date.now() }),
    [items, days, scope],
  )
  const picked = plan.pick.filter(i => !off.has(i.id))
  const busy = progress !== null
  const toggle = (id: string, on: boolean): void =>
    setOff(prev => {
      const next = new Set(prev)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async (): Promise<void> => {
    const ids = picked.map(i => i.id),
      titles = new Map(picked.map(i => [i.id, i.title]))
    setFailed([])
    setProgress({ done: 0, total: ids.length })
    const result = await archiveBatch(ids, done => setProgress({ done, total: ids.length }))
    setProgress(null)
    if (result.done.length) onArchived(result.done)
    if (result.failed.length) setFailed(result.failed.map(f => ({ ...f, title: titles.get(f.id) ?? f.id })))
    else closeArchiveOld()
  }

  const now = Date.now()
  const row = (item: ArchiveItem, reason?: string) => {
    const ago = idleLabel(item.lastActive, now)
    return (
      <label
        key={item.id}
        className={cn(
          'flex h-8 items-center gap-2.5 px-1.5',
          reason ? 'text-fg-faint' : 'rounded-md text-fg hover:bg-hover',
        )}
      >
        <input
          type="checkbox"
          disabled={!!reason || busy}
          checked={!reason && !off.has(item.id)}
          aria-label={t('archiveOld.pick', { title: item.title })}
          onChange={e => toggle(item.id, e.target.checked)}
        />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <span className="w-28 shrink-0 truncate font-mono text-meta text-fg-muted">{item.projectName}</span>
        <span className="w-20 shrink-0 text-right text-meta text-fg-faint">{reason ?? t(ago.key, { n: ago.n })}</span>
      </label>
    )
  }

  return (
    <ConfirmDialog
      wide
      title={t('archiveOld.title')}
      description={
        <div data-archive-old>
          <p>{t('archiveOld.desc')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-fg-secondary">
            <span>{t('archiveOld.over')}</span>
            <Segmented
              label={t('archiveOld.daysLabel')}
              disabled={busy}
              value={preset}
              onChange={setPreset}
              options={[
                ...PRESET_DAYS.map(d => ({ value: `${d}` as Preset, label: `${d}` })),
                { value: 'custom' as Preset, label: t('archiveOld.custom') },
              ]}
            />
            {preset === 'custom' && (
              <input
                inputMode="numeric"
                value={custom}
                disabled={busy}
                aria-label={t('archiveOld.customDays')}
                aria-invalid={days === null}
                onChange={e => setCustom(e.target.value)}
                className={cn(
                  'h-8 w-16 rounded-md border bg-surface px-2 font-mono text-meta text-fg outline-none',
                  days === null ? 'border-danger' : 'border-line focus:border-accent-line',
                )}
              />
            )}
            <span>{t('archiveOld.daysIdle')}</span>
            <Select
              label={t('archiveOld.scope')}
              className="ml-auto w-44!"
              disabled={busy}
              value={scope}
              onChange={setScope}
              options={[
                { value: ALL, label: t('archiveOld.scopeAll') },
                ...scopes.map(s => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          {days === null && <p className="mt-2 text-meta text-danger">{t('archiveOld.invalidDays')}</p>}
          {days !== null && plan.pick.length === 0 && plan.skip.length === 0 && (
            <p className="mt-4 text-center text-fg-faint">{t('archiveOld.empty', { days })}</p>
          )}
          {plan.pick.length > 0 && (
            <>
              <div className="mt-3 flex items-center gap-2.5 border-y border-line-subtle bg-subtle px-1.5 py-1.5 text-meta text-fg-muted">
                <input
                  type="checkbox"
                  disabled={busy}
                  aria-label={t('archiveOld.selectAll')}
                  checked={picked.length === plan.pick.length}
                  onChange={e => setOff(e.target.checked ? new Set() : new Set(plan.pick.map(i => i.id)))}
                />
                <b className="font-medium text-fg">
                  {t('archiveOld.selected', { picked: picked.length, total: plan.pick.length })}
                </b>
                <span>{t('archiveOld.order')}</span>
              </div>
              <div className="max-h-56 overflow-y-auto [scrollbar-width:thin]">{plan.pick.map(i => row(i))}</div>
            </>
          )}
          {plan.skip.length > 0 && (
            <>
              <div className="mt-3 px-1.5 text-meta text-fg-faint">
                {t('archiveOld.skipTitle', { count: plan.skip.length })}
              </div>
              <div className="max-h-32 overflow-y-auto [scrollbar-width:thin]">
                {plan.skip.map(s => row(s.item, t(`archiveOld.skip.${s.reason}`)))}
              </div>
              <p className="mt-1 px-1.5 text-meta text-fg-faint">{t('archiveOld.skipHint')}</p>
            </>
          )}
          {failed.length > 0 && (
            <ul className="mt-3 flex flex-col gap-0.5 text-meta text-danger">
              {failed.map(f => (
                <li key={f.id} className="break-words">
                  {f.title}：{f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      error={failed.length ? t('archiveOld.failed', { count: failed.length }) : null}
      busy={busy}
      confirmDisabled={picked.length === 0}
      confirmLabel={progress ? t('archiveOld.progress', progress) : t('archiveOld.confirm', { count: picked.length })}
      cancelLabel={t('session.cancel')}
      onConfirm={() => void run()}
      onCancel={closeArchiveOld}
    />
  )
}
