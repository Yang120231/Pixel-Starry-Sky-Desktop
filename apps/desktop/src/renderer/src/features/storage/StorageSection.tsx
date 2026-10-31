// 设置 › 存储：本机数据目录的占用（分类色条）和清理入口——清理旧会话、已归档的会话、项目副本、界面缓存。
// 数据由主进程统计（main/storage），这里只显示和发起操作；删掉、恢复之后在本地更新统计结果，不重新扫一遍。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderOpen, RefreshCw, X } from 'lucide-react'
import { Button, Segmented, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Select } from '@/ui/Select'
import { Toast } from '@/ui/Toast'
import { useI18n } from '@/i18n/I18nProvider'
import { SectionTitle } from '../settings/SettingRow'
import { idleLabel } from '../sidebar/archiveOld'
import type { StoragePartKey, StorageSession, StorageUsage } from '../../../../shared/types/storage'
import {
  archivedSessions,
  formatBytes,
  oldSessions,
  percentLabel,
  segments,
  totalBytes,
  withRestored,
  withoutSessions,
} from './storageView'

/** 每类的颜色：沿用用量图表的配色变量，深浅色和各套配色都自带 */
const PART_COLOR: Record<StoragePartKey, string> = {
  sessions: 'var(--chart-cache)',
  archived: 'var(--chart-bar-output)',
  copies: 'var(--chart-input)',
  cache: 'var(--chart-output)',
  logs: 'var(--warn)',
  other: 'var(--text-faint)',
}
const DAY_PRESETS = ['7', '30', '90'] as const
type DayPreset = (typeof DAY_PRESETS)[number]
const DEFAULT_DAYS = 30

export function StorageSection({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const { t } = useI18n()
  const bridge = window.pixelsky?.storage
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'old' | 'archived' | null>(null)
  const [copiesOpen, setCopiesOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [hover, setHover] = useState<StoragePartKey | null>(null)

  const load = useCallback(
    async (force: boolean) => {
      if (!bridge) return
      setScanning(true)
      setError(null)
      try {
        setUsage(await bridge.usage(force))
      } catch (e) {
        setError(String((e as Error)?.message ?? e))
      } finally {
        setScanning(false)
      }
    },
    [bridge],
  )
  useEffect(() => {
    void load(false)
  }, [load])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const now = usage?.scannedAt ?? 0
  const oldCount = useMemo(
    () =>
      usage ? oldSessions(usage.sessions, { days: DEFAULT_DAYS, includeArchived: false, sort: 'time', now }).length : 0,
    [usage, now],
  )
  const archivedCount = useMemo(() => (usage ? archivedSessions(usage.sessions).length : 0), [usage])

  if (!bridge)
    return (
      <section>
        <SectionTitle>{t('storage.title')}</SectionTitle>
        <p className="text-meta text-fg-muted">{t('storage.unavailable')}</p>
      </section>
    )

  const segs = usage ? segments(usage) : []
  const onDeleted = (ids: string[], freed: number, failed: number): void => {
    if (ids.length) setUsage(u => (u ? withoutSessions(u, ids) : u))
    const parts = [ids.length ? t('storage.deleted', { n: ids.length, size: formatBytes(freed) }) : null]
    if (failed) parts.push(t('storage.deleteFailed', { n: failed }))
    setToast(parts.filter(Boolean).join(' · '))
  }
  const clearCache = async (): Promise<void> => {
    setClearing(true)
    try {
      const freed = await bridge.clearCache()
      setToast(t('storage.cacheCleared', { size: formatBytes(freed) }))
      void load(true)
    } catch (e) {
      setToast(String((e as Error)?.message ?? e))
    } finally {
      setClearing(false)
    }
  }

  return (
    <section data-storage-section>
      <SectionTitle>{t('storage.title')}</SectionTitle>

      <h4 className="text-ui font-semibold text-fg">{t('storage.device')}</h4>
      <p className="mt-1 mb-4 text-meta text-fg-muted">{t('storage.deviceDesc')}</p>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-ui font-medium text-fg tabular-nums">
          {usage ? t('storage.total', { size: formatBytes(totalBytes(usage)) }) : t('storage.scanning')}
        </div>
        <Button variant="ghost" className="h-7 px-2 text-meta" disabled={scanning} onClick={() => void load(true)}>
          <RefreshCw size={13} strokeWidth={1.75} className={cn(scanning && 'animate-spin')} />
          {scanning ? t('storage.scanning') : t('storage.rescan')}
        </Button>
      </div>

      <div
        className="flex h-5 gap-0.5 overflow-hidden rounded-md bg-subtle"
        role="img"
        aria-label={segs.map(s => `${t(`storage.part.${s.key}`)} ${formatBytes(s.bytes)}`).join(', ')}
      >
        {segs.map(s => (
          <div
            key={s.key}
            title={`${t(`storage.part.${s.key}`)} · ${formatBytes(s.bytes)} · ${t('storage.percent', { n: percentLabel(s.percent) })}\n${t(`storage.partDesc.${s.key}`)}`}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className="h-full min-w-[3px] transition-[width,opacity] duration-500"
            style={{
              width: `${s.percent}%`,
              background: PART_COLOR[s.key],
              opacity: hover && hover !== s.key ? 0.35 : 1,
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {segs.map(s => (
          <div
            key={s.key}
            className="min-w-16 cursor-default"
            title={t(`storage.partDesc.${s.key}`)}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="flex items-center gap-1.5 text-meta text-fg-secondary">
              <span className="size-2 shrink-0 rounded-full" style={{ background: PART_COLOR[s.key] }} />
              {t(`storage.part.${s.key}`)}
            </div>
            <div className="mt-0.5 pl-3.5 text-meta text-fg-muted tabular-nums">
              {scanning ? t('storage.scanning') : formatBytes(s.bytes)}
            </div>
          </div>
        ))}
      </div>

      {usage && (
        <div className="mt-3 flex min-w-0 items-center gap-2 text-meta text-fg-faint">
          <span className="min-w-0 truncate font-mono" title={usage.root}>
            {usage.root}
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-accent-fg hover:underline"
            onClick={() => void bridge.open().catch((e: unknown) => setToast(String((e as Error)?.message ?? e)))}
          >
            <FolderOpen size={12} strokeWidth={1.75} />
            {t('storage.openFolder')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-meta text-danger">{error}</p>}

      <Card className="mt-6">
        <Row
          title={t('storage.oldTitle')}
          badge={usage && oldCount > 0 ? t('storage.oldCount', { n: oldCount, days: DEFAULT_DAYS }) : null}
          description={t('storage.oldDesc')}
          action={
            <Button className="h-7 px-3 text-meta" disabled={!usage} onClick={() => setDialog('old')}>
              {t('storage.review')}
            </Button>
          }
        />
      </Card>

      <Card className="mt-4">
        <Row
          title={t('storage.archivedTitle')}
          badge={usage ? t('storage.archivedCount', { n: archivedCount }) : null}
          description={t('storage.archivedDesc')}
          action={
            <Button className="h-7 px-3 text-meta" disabled={!usage} onClick={() => setDialog('archived')}>
              {t('storage.manage')}
            </Button>
          }
        />
        <Row
          title={t('storage.copiesTitle')}
          badge={usage ? t('storage.copiesCount', { n: usage.copies.length }) : null}
          description={t('storage.copiesDesc')}
          action={
            <Button
              className="h-7 px-3 text-meta"
              disabled={!usage}
              aria-expanded={copiesOpen}
              onClick={() => setCopiesOpen(o => !o)}
            >
              {copiesOpen ? t('storage.collapse') : t('storage.review')}
            </Button>
          }
        >
          {copiesOpen && usage && (
            <div className="mt-3 border-t border-line-subtle pt-2">
              {usage.copies.length === 0 ? (
                <p className="py-2 text-meta text-fg-faint">{t('storage.emptyCopies')}</p>
              ) : (
                [...usage.copies]
                  .sort((a, b) => b.bytes - a.bytes)
                  .map(c => (
                    <div key={c.id} className="flex items-center gap-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-list text-fg">
                          {c.name}
                          <span className="ml-2 font-mono text-meta text-fg-faint">{c.branch}</span>
                        </div>
                        <div className="truncate font-mono text-meta text-fg-faint" title={c.path}>
                          {c.projectName ? `${c.projectName} · ` : ''}
                          {c.path}
                        </div>
                      </div>
                      {(c.missing || c.dirty) && (
                        <span className={cn('shrink-0 text-meta', c.missing ? 'text-fg-faint' : 'text-warn')}>
                          {t(c.missing ? 'storage.copyMissing' : 'storage.copyDirty')}
                        </span>
                      )}
                      <span className="w-20 shrink-0 text-right text-meta text-fg-muted tabular-nums">
                        {formatBytes(c.bytes)}
                      </span>
                    </div>
                  ))
              )}
            </div>
          )}
        </Row>
        <Row
          title={t('storage.cacheTitle')}
          badge={usage ? formatBytes(usage.parts.cache) : null}
          description={t('storage.cacheDesc')}
          action={
            <Button className="h-7 px-3 text-meta" disabled={clearing} onClick={() => void clearCache()}>
              {t('storage.clearCache')}
            </Button>
          }
        />
      </Card>

      {dialog === 'old' && usage && (
        <OldSessionsDialog usage={usage} onClose={() => setDialog(null)} onDeleted={onDeleted} />
      )}
      {dialog === 'archived' && usage && (
        <ArchivedDialog
          usage={usage}
          onClose={() => setDialog(null)}
          onDeleted={onDeleted}
          onRestored={(id, title) => {
            setUsage(u => (u ? withRestored(u, id) : u))
            setToast(t('storage.restored', { title }))
          }}
          onOpen={id => {
            setDialog(null)
            onOpenSession(id)
          }}
        />
      )}
      {toast && (
        <Toast className="py-2.5 text-list">
          <span className="min-w-0 break-words">{toast}</span>
          <button
            aria-label={t('storage.close')}
            onClick={() => setToast(null)}
            className="shrink-0 rounded-sm p-1 text-fg-muted hover:bg-hover"
          >
            <X size={14} />
          </button>
        </Toast>
      )}
    </section>
  )
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-lg border border-line-card bg-surface', className)}>{children}</div>
}

function Row({
  title,
  badge,
  description,
  action,
  children,
}: {
  title: string
  badge?: string | null
  description: string
  action: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="border-t border-line-subtle px-4 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-ui font-medium text-fg">
            {title}
            {badge && (
              <span className="rounded-full bg-subtle px-2 py-px text-meta font-normal text-fg-muted">{badge}</span>
            )}
          </div>
          <p className="mt-0.5 text-meta text-fg-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/** 名字为空的会话显示「未命名会话」 */
function useTitle(): (s: StorageSession) => string {
  const { t } = useI18n()
  return s => s.title.trim() || t('storage.untitled')
}

/** 一行会话：勾选框、标题和项目、多久没动、大小；extra 放在大小后面（恢复按钮） */
function SessionRow({
  session,
  checked,
  disabled,
  now,
  onToggle,
  extra,
}: {
  session: StorageSession
  checked: boolean
  disabled: boolean
  now: number
  onToggle: (on: boolean) => void
  extra?: ReactNode
}) {
  const { t } = useI18n()
  const title = useTitle()(session)
  const ago = idleLabel(session.updatedAt, now)
  return (
    <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-hover">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={t('storage.pick', { title })}
        onChange={e => onToggle(e.target.checked)}
      />
      <label className="min-w-0 flex-1 cursor-pointer" onClick={() => !disabled && onToggle(!checked)}>
        <div className="truncate text-fg">{title}</div>
        <div className="truncate text-meta text-fg-faint">{session.projectName ?? t('storage.noProject')}</div>
      </label>
      <span className="w-16 shrink-0 text-right text-meta text-fg-faint">{t(ago.key, { n: ago.n })}</span>
      <span className="w-16 shrink-0 text-right text-meta text-fg-muted tabular-nums">
        {formatBytes(session.bytes)}
      </span>
      {extra}
    </div>
  )
}

/** 勾选、删除一批会话：两个对话框共用 */
function useDeletion(
  list: readonly StorageSession[],
  onDeleted: (ids: string[], freed: number, failed: number) => void,
  onClose: () => void,
) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<Array<{ title: string; message: string }>>([])
  const title = useTitle()
  // 列表变了（换了天数、删掉了几个）：只留还在列表里的勾选
  const visible = useMemo(() => new Set(list.map(s => s.id)), [list])
  const selected = list.filter(s => picked.has(s.id) && visible.has(s.id))
  const bytes = selected.reduce((sum, s) => sum + s.bytes, 0)
  const toggle = (id: string, on: boolean): void =>
    setPicked(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const toggleAll = (on: boolean): void => setPicked(on ? new Set(list.map(s => s.id)) : new Set())
  const run = async (): Promise<void> => {
    const bridge = window.pixelsky?.storage
    if (!bridge || !selected.length) return
    setBusy(true)
    setFailed([])
    try {
      const result = await bridge.deleteSessions(selected.map(s => s.id))
      const done = new Set(result.done)
      const freed = selected.filter(s => done.has(s.id)).reduce((sum, s) => sum + s.bytes, 0)
      onDeleted(result.done, freed, result.failed.length)
      if (result.failed.length) {
        const byId = new Map(selected.map(s => [s.id, s]))
        setFailed(
          result.failed.map(f => ({ title: byId.has(f.id) ? title(byId.get(f.id)!) : f.id, message: f.message })),
        )
        setPicked(new Set(result.failed.map(f => f.id)))
      } else onClose()
    } catch (e) {
      setFailed([{ title: '', message: String((e as Error)?.message ?? e) }])
    } finally {
      setBusy(false)
    }
  }
  return { picked, selected, bytes, busy, failed, toggle, toggleAll, run }
}

function SelectionBar({
  total,
  selected,
  bytes,
  disabled,
  onToggleAll,
  children,
}: {
  total: number
  selected: number
  bytes: number
  disabled: boolean
  onToggleAll: (on: boolean) => void
  children?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="mt-3 flex items-center gap-2.5 border-y border-line-subtle bg-subtle px-1.5 py-1.5 text-meta text-fg-muted">
      <input
        type="checkbox"
        disabled={disabled || total === 0}
        aria-label={t('storage.selectAll')}
        checked={total > 0 && selected === total}
        onChange={e => onToggleAll(e.target.checked)}
      />
      <span className="flex-1">
        {selected ? t('storage.selected', { n: selected, size: formatBytes(bytes) }) : t('storage.noneSelected')}
      </span>
      {children}
    </div>
  )
}

function FailedList({ failed }: { failed: Array<{ title: string; message: string }> }) {
  if (!failed.length) return null
  return (
    <ul className="mt-3 flex flex-col gap-0.5 text-meta text-danger">
      {failed.map((f, i) => (
        <li key={i} className="break-words">
          {f.title ? `${f.title}: ${f.message}` : f.message}
        </li>
      ))}
    </ul>
  )
}

function OldSessionsDialog({
  usage,
  onClose,
  onDeleted,
}: {
  usage: StorageUsage
  onClose: () => void
  onDeleted: (ids: string[], freed: number, failed: number) => void
}) {
  const { t } = useI18n()
  const [days, setDays] = useState<DayPreset>(`${DEFAULT_DAYS}`)
  const [sort, setSort] = useState<'size' | 'time'>('size')
  const [includeArchived, setIncludeArchived] = useState(false)
  const now = usage.scannedAt
  const list = useMemo(
    () => oldSessions(usage.sessions, { days: Number(days), includeArchived, sort, now }),
    [usage.sessions, days, includeArchived, sort, now],
  )
  const del = useDeletion(list, onDeleted, onClose)
  return (
    <ConfirmDialog
      wide
      danger
      title={t('storage.oldTitle')}
      description={
        <div data-storage-old>
          <p>{t('storage.oldDialogDesc')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-fg-secondary">
            <span>{t('storage.over')}</span>
            <Segmented
              label={t('storage.daysLabel')}
              disabled={del.busy}
              value={days}
              onChange={setDays}
              options={DAY_PRESETS.map(d => ({ value: d, label: d }))}
            />
            <span>{t('storage.daysIdle')}</span>
            <Select
              label={t('storage.sortLabel')}
              className="ml-auto w-28!"
              disabled={del.busy}
              value={sort}
              onChange={setSort}
              options={[
                { value: 'size', label: t('storage.sortSize') },
                { value: 'time', label: t('storage.sortTime') },
              ]}
            />
          </div>
          <SelectionBar
            total={list.length}
            selected={del.selected.length}
            bytes={del.bytes}
            disabled={del.busy}
            onToggleAll={del.toggleAll}
          >
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeArchived}
                disabled={del.busy}
                onChange={e => setIncludeArchived(e.target.checked)}
              />
              {t('storage.includeArchived')}
            </label>
          </SelectionBar>
          {list.length === 0 ? (
            <p className="py-6 text-center text-fg-faint">{t('storage.emptyOld', { days })}</p>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1 [scrollbar-width:thin]">
              {list.map(s => (
                <SessionRow
                  key={s.id}
                  session={s}
                  now={now}
                  checked={del.picked.has(s.id)}
                  disabled={del.busy}
                  onToggle={on => del.toggle(s.id, on)}
                />
              ))}
            </div>
          )}
          <FailedList failed={del.failed} />
        </div>
      }
      busy={del.busy}
      confirmDisabled={del.selected.length === 0}
      confirmLabel={
        del.busy
          ? t('storage.deleting')
          : del.selected.length
            ? t('storage.deleteN', { n: del.selected.length })
            : t('storage.delete')
      }
      cancelLabel={t('session.cancel')}
      onConfirm={() => void del.run()}
      onCancel={onClose}
    />
  )
}

function ArchivedDialog({
  usage,
  onClose,
  onDeleted,
  onRestored,
  onOpen,
}: {
  usage: StorageUsage
  onClose: () => void
  onDeleted: (ids: string[], freed: number, failed: number) => void
  onRestored: (id: string, title: string) => void
  onOpen: (id: string) => void
}) {
  const { t } = useI18n()
  const list = useMemo(() => archivedSessions(usage.sessions), [usage.sessions])
  const del = useDeletion(list, onDeleted, onClose)
  const title = useTitle()
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const restore = async (s: StorageSession): Promise<void> => {
    setRestoring(s.id)
    setRestoreError(null)
    try {
      await window.pixelsky!.storage.restoreSession(s.id)
      del.toggle(s.id, false)
      onRestored(s.id, title(s))
    } catch (e) {
      setRestoreError(`${title(s)}: ${String((e as Error)?.message ?? e)}`)
    } finally {
      setRestoring(null)
    }
  }
  const busy = del.busy || restoring !== null
  return (
    <ConfirmDialog
      wide
      danger
      title={t('storage.archivedTitle')}
      description={
        <div data-storage-archived>
          <p>{t('storage.archivedDesc')}</p>
          <SelectionBar
            total={list.length}
            selected={del.selected.length}
            bytes={del.bytes}
            disabled={busy}
            onToggleAll={del.toggleAll}
          />
          {list.length === 0 ? (
            <p className="py-6 text-center text-fg-faint">{t('storage.emptyArchived')}</p>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1 [scrollbar-width:thin]">
              {list.map(s => (
                <SessionRow
                  key={s.id}
                  session={s}
                  now={usage.scannedAt}
                  checked={del.picked.has(s.id)}
                  disabled={busy}
                  onToggle={on => del.toggle(s.id, on)}
                  extra={
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onOpen(s.id)}
                        className="rounded-md px-2 py-0.5 text-meta text-fg-secondary hover:bg-selected disabled:opacity-50"
                      >
                        {t('storage.open')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void restore(s)}
                        className="rounded-md px-2 py-0.5 text-meta text-accent-fg hover:bg-selected disabled:opacity-50"
                      >
                        {t('storage.restore')}
                      </button>
                    </span>
                  }
                />
              ))}
            </div>
          )}
          {restoreError && <p className="mt-2 text-meta text-danger">{restoreError}</p>}
          <FailedList failed={del.failed} />
        </div>
      }
      busy={busy}
      confirmDisabled={del.selected.length === 0}
      confirmLabel={
        del.busy
          ? t('storage.deleting')
          : del.selected.length
            ? t('storage.deleteN', { n: del.selected.length })
            : t('storage.delete')
      }
      cancelLabel={t('storage.close')}
      onConfirm={() => void del.run()}
      onCancel={onClose}
    />
  )
}
