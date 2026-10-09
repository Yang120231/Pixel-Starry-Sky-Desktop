import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronRight,
  File,
  FileArchive,
  FileCode2,
  FileText,
  Film,
  Globe,
  Image,
  MessageSquareText,
  Package,
  RefreshCw,
  Sheet,
  type LucideIcon,
} from 'lucide-react'
import { cn, DiffStat, EngineIcon, IconButton, Segmented, Spinner } from '@/components/ui'
import { DiffView } from '@/components/session/live/ItemRows'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { OPEN_SESSION_EVENT } from '@/engine/openRequests'
import { relativeTime } from '@/engine'
import { openFile } from '@/files/store'
import { machineOf } from '@/machines/store'
import { demoArtifactChange, demoArtifacts } from '@/mock/artifacts'
import type {
  ArtifactDelivery,
  ArtifactFile,
  ArtifactResponse,
  ArtifactTurn,
  DeliveryType,
  FileChange,
} from '@pixelsky/protocol'
import type { WorkspaceRef } from '../../../../../preload/workspace'
import { useProjectContext } from '../projectContext'
import { NoProject, useRemember } from '../ToolsUi'
import { EmptyState, PanelCard } from '../PanelSurface'
import { groupBySession, splitArtifactPath } from './artifactsModel'
import { ArtifactPreview } from './ArtifactPreview'

const DAYS = 7
const TYPE_ICON: Record<DeliveryType | 'other', LucideIcon> = {
  document: FileText,
  image: Image,
  table: Sheet,
  web: Globe,
  archive: FileArchive,
  media: Film,
  other: File,
}
const openSession = (sessionId: string, itemId: string | null) =>
  window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId, ...(itemId ? { itemId } : {}) } }))

export function ArtifactsPanel({ active }: { active: boolean }) {
  useI18n()
  const context = useProjectContext()
  if (!context.ref && !context.demo) return <NoProject />
  return (
    <ArtifactsBody
      key={context.key + ':' + JSON.stringify(context.ref)}
      target={context.ref ?? { projectId: 'demo' }}
      name={context.name}
      demo={context.demo}
      active={active}
    />
  )
}

function ArtifactsBody({
  target,
  name,
  demo,
  active,
}: {
  target: WorkspaceRef
  name: string
  demo: boolean
  active: boolean
}) {
  useI18n()
  const [tab, setTab] = useRemember<'changes' | 'delivered'>('pixelsky.artifacts.tab', 'changes')
  const [data, setData] = useState<ArtifactResponse | null>(demo ? demoArtifacts : null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<ArtifactDelivery | null>(null)
  const request = useRef(0)
  const [now, setNow] = useState(Date.now)
  const remote = machineOf(target.sessionId ?? target.projectId) !== 'local'

  const load = async () => {
    if (demo || !window.pixelsky) return
    const id = ++request.current
    setLoading(true)
    try {
      const res = await window.pixelsky.artifacts.list({
        requestId: id,
        ...(target.sessionId ? { sessionId: target.sessionId } : { projectId: target.projectId }),
        days: DAYS,
      })
      if (id === request.current && !res.cancelled) {
        setData(res)
        setError('')
        setNow(Date.now())
      }
    } catch (e) {
      if (id === request.current) setError((e as Error).message)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  // 打开产物页时读取；可见时回合结束（去抖）再读
  useEffect(() => {
    if (!active || demo || !window.pixelsky) return
    void load()
    let timer = 0
    const off = window.pixelsky.engine.onEvent(e => {
      if (e.kind === 'session' && e.event.type === 'turn_completed') {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void load(), 800)
      }
    })
    return () => {
      window.clearTimeout(timer)
      off()
    }
  }, [active])

  const groups = useMemo(() => groupBySession(data?.turns ?? []), [data])
  if (preview)
    return (
      <ArtifactPreview
        item={preview}
        demo={demo}
        remote={remote}
        onBack={() => setPreview(null)}
        onError={setError}
        onOpenInEditor={
          preview.local && preview.inside && preview.exists ? () => void openFile(target, preview.local!) : undefined
        }
      />
    )

  return (
    <div data-artifacts-panel className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-ui font-medium text-fg">{tr('artifacts.title')}</h2>
          <p className="truncate text-meta text-fg-muted">
            {name} · {tr('artifacts.window', { days: DAYS })}
          </p>
        </div>
        {loading && <Spinner size={13} />}
        <IconButton
          icon={RefreshCw}
          label={tr('artifacts.refresh')}
          disabled={loading || demo}
          onClick={() => void load()}
        />
      </div>
      <div className="shrink-0 px-3 pt-2">
        <Segmented
          label={tr('artifacts.tabs')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'changes', label: tr('artifacts.tab.changes') },
            {
              value: 'delivered',
              label: `${tr('artifacts.tab.delivered')}${data?.delivered.length ? ` ${data.delivered.length}` : ''}`,
            },
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {error && (
          <p role="alert" className="shrink-0 rounded-md bg-subtle p-2 text-meta text-danger">
            {translateMessage(error)}
          </p>
        )}
        {!data ? (
          <div className="flex items-center justify-center gap-2 p-6 text-meta text-fg-muted">
            <Spinner size={13} />
            {tr('projectTools.loading')}
          </div>
        ) : tab === 'changes' ? (
          groups.length === 0 ? (
            <PanelCard>
              <EmptyState
                icon={Package}
                title={tr('artifacts.changesEmpty', { days: DAYS })}
                hint={tr('artifacts.changesHint')}
              />
            </PanelCard>
          ) : (
            groups.map(g => (
              <section
                key={g.sessionId}
                data-artifact-session={g.sessionId}
                className="shrink-0 rounded-lg border border-line-card bg-surface shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => openSession(g.sessionId, null)}
                  className="flex w-full min-w-0 items-center gap-2 border-b border-line-subtle px-3 py-2 text-left hover:bg-hover"
                >
                  <EngineIcon engine={g.engine} size={14} />
                  <span className="min-w-0 flex-1 truncate text-list font-medium text-fg">{g.title}</span>
                  {g.archived && (
                    <span className="shrink-0 rounded bg-subtle px-1.5 text-meta text-fg-muted">
                      {tr('artifacts.archived')}
                    </span>
                  )}
                </button>
                {g.turns.map(turn => (
                  <TurnBlock
                    key={turn.sessionId + ':' + (turn.userItemId ?? 'start') + ':' + turn.at}
                    turn={turn}
                    target={target}
                    demo={demo}
                    now={now}
                  />
                ))}
              </section>
            ))
          )
        ) : data.delivered.length === 0 ? (
          <PanelCard>
            <EmptyState icon={Package} title={tr('artifacts.deliveredEmpty')} hint={tr('artifacts.deliveredHint')} />
          </PanelCard>
        ) : (
          <ul className="flex shrink-0 flex-col gap-1">
            {data.delivered.map(d => (
              <DeliveryRow key={d.absolute} item={d} now={now} onOpen={() => setPreview(d)} />
            ))}
          </ul>
        )}
        {data && tab === 'changes' && data.outsideCount > 0 && (
          <button
            type="button"
            onClick={() => setTab('delivered')}
            className="shrink-0 self-start rounded-md px-1 text-meta text-accent-fg hover:underline"
          >
            {tr('artifacts.outside', { count: data.outsideCount })}
          </button>
        )}
        {data?.truncated && <p className="shrink-0 text-meta text-warn">{tr('artifacts.truncated')}</p>}
        {data?.partial && <p className="shrink-0 text-meta text-fg-faint">{tr('artifacts.partial')}</p>}
      </div>
    </div>
  )
}

function TurnBlock({
  turn,
  target,
  demo,
  now,
}: {
  turn: ArtifactTurn
  target: WorkspaceRef
  demo: boolean
  now: number
}) {
  useI18n()
  return (
    <div className="border-b border-line-subtle px-1.5 py-1.5 last:border-b-0">
      <button
        type="button"
        onClick={() => openSession(turn.sessionId, turn.userItemId)}
        title={tr('artifacts.jump')}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-meta text-fg-muted hover:bg-hover"
      >
        <MessageSquareText size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{turn.prompt || tr('artifacts.noPrompt')}</span>
        <span className="shrink-0 text-fg-faint tabular-nums">{relativeTime(turn.at, now)}</span>
      </button>
      <ul className="flex flex-col">
        {turn.files.map(f => (
          <FileRow key={f.absolute} file={f} turn={turn} target={target} demo={demo} />
        ))}
      </ul>
    </div>
  )
}

function FileRow({
  file,
  turn,
  target,
  demo,
}: {
  file: ArtifactFile
  turn: ArtifactTurn
  target: WorkspaceRef
  demo: boolean
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const [change, setChange] = useState<FileChange | null | 'loading'>(null)
  const { name, dir } = splitArtifactPath(file.local ?? file.path)
  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (change && change !== 'loading') return
    setChange('loading')
    if (demo) {
      setChange(demoArtifactChange(file.itemId, file.path))
      return
    }
    try {
      const item = await window.pixelsky!.artifacts.change({ sessionId: turn.sessionId, itemId: file.itemId })
      setChange(item?.changes.find(c => c.path === file.path) ?? null)
    } catch {
      setChange(null)
    }
  }
  return (
    <li className="group/file">
      <div className="flex h-7 min-w-0 items-center gap-1 rounded-md pr-0.5 hover:bg-hover">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => void toggle()}
          title={open ? tr('artifacts.hideDiff') : tr('artifacts.viewDiff')}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-1.5 text-left"
        >
          <ChevronRight size={12} className={cn('shrink-0 text-fg-faint transition-transform', open && 'rotate-90')} />
          <span
            className={cn(
              'shrink-0 truncate text-list',
              file.kind === 'delete' ? 'text-fg-muted line-through' : 'text-fg',
            )}
          >
            {name}
          </span>
          {dir && <span className="min-w-0 truncate text-meta text-fg-faint">{dir}</span>}
          {file.kind !== 'update' && (
            <span
              className={cn(
                'shrink-0 rounded px-1 text-[10px] leading-4 font-medium',
                file.kind === 'add' ? 'bg-subtle text-success' : 'bg-subtle text-danger',
              )}
            >
              {tr(file.kind === 'add' ? 'artifacts.kind.add' : 'artifacts.kind.delete')}
            </span>
          )}
          <span className="flex-1" />
          <DiffStat added={file.added} removed={file.removed} className="text-meta" />
        </button>
        <span className="flex shrink-0 items-center opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100">
          {file.local && file.kind !== 'delete' && (
            <IconButton
              icon={FileCode2}
              label={tr('artifacts.openFile')}
              size={22}
              iconSize={12}
              onClick={() => void openFile(target, file.local!)}
            />
          )}
          <IconButton
            icon={MessageSquareText}
            label={tr('artifacts.jump')}
            size={22}
            iconSize={12}
            onClick={() => openSession(turn.sessionId, file.itemId)}
          />
        </span>
      </div>
      {open && (
        <div className="mb-1.5 ml-5 overflow-hidden rounded-md border border-line-subtle">
          {change === 'loading' ? (
            <div className="flex items-center gap-2 p-2 text-meta text-fg-muted">
              <Spinner size={12} />
              {tr('projectTools.loading')}
            </div>
          ) : change?.diff ? (
            <DiffView diff={change.diff} path={file.path} className="max-h-80" />
          ) : (
            <p className="p-2 text-meta text-fg-faint">{tr('artifacts.diffMissing')}</p>
          )}
        </div>
      )}
    </li>
  )
}

function DeliveryRow({ item, now, onOpen }: { item: ArtifactDelivery; now: number; onOpen: () => void }) {
  useI18n()
  const Icon = TYPE_ICON[item.type]
  const { name, dir } = splitArtifactPath(item.local ?? item.absolute)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-artifact-delivery={item.absolute}
        className={cn(
          'flex w-full min-w-0 items-start gap-2.5 rounded-lg border border-line-card bg-surface px-3 py-2 text-left shadow-sm hover:border-line-strong',
          !item.exists && 'opacity-60',
        )}
      >
        <Icon size={16} className="mt-0.5 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-list font-medium text-fg">{name}</span>
            {!item.inside && (
              <span className="shrink-0 rounded bg-subtle px-1 text-[10px] leading-4 text-fg-muted">
                {tr('artifacts.outsideBadge')}
              </span>
            )}
            {!item.exists && <span className="shrink-0 text-meta text-danger">{tr('artifacts.missing')}</span>}
          </span>
          <span className="block truncate text-meta text-fg-faint" title={item.absolute}>
            {dir}
          </span>
          <span className="block truncate text-meta text-fg-muted">
            {item.title} · {relativeTime(item.at, now)}
          </span>
        </span>
      </button>
    </li>
  )
}
