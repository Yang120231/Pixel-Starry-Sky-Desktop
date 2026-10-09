import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CloudDownload,
  FileCode2,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { Button, cn, IconButton, Spinner } from '@/components/ui'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { openFile } from '@/files/store'
import { machineOf } from '@/machines/store'
import { useProjectContext } from '../projectContext'
import { openRightTab } from '../workspaceStore'
import { NoProject } from '../ToolsUi'
import { EmptyState, PanelCard } from '../PanelSurface'
import type {
  GitArea,
  GitBranch as Branch,
  GitFailure,
  GitFileChange,
  GitRemedy,
  GitResult,
  GitStatus,
} from '../../../../../shared/types/project-tools'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import {
  ago,
  changeCount,
  failureHint,
  failureTitle,
  gitSections,
  needsCommitAll,
  neighbour,
  splitPath,
  type GitSection,
} from './gitModel'
import { GitDiffView } from './GitDiffView'
import { BranchMenu } from './BranchMenu'
import { demo as demoData } from '@/data/demo'

/** 命令面板触发的 Git 操作（docs/ui/git-panel.md §6）：先打开 Git 页，状态读到后再执行 */
export type GitPaletteAction = 'pull' | 'push' | 'fetch' | 'branch'
const GIT_ACTION_EVENT = 'pixelsky:git-action'
let pendingAction: GitPaletteAction | null = null
export function requestGitAction(action: GitPaletteAction): void {
  pendingAction = action
  window.dispatchEvent(new Event(GIT_ACTION_EVENT))
}

const POLL_MS = 15_000
const AUTO_FETCH_MS = 10 * 60_000

export function GitPanel({ active }: { active: boolean }) {
  useI18n()
  const context = useProjectContext()
  if (!context.ref && !context.demo) return <NoProject />
  return (
    <GitBody
      key={context.key + ':' + JSON.stringify(context.ref)}
      target={context.ref ?? { projectId: 'demo' }}
      demo={context.demo}
      active={active}
    />
  )
}

type Confirm = { title: string; body: ReactNode; label: string; danger: boolean; run: () => void }

// 演示模式：在内存里模拟操作结果，方便看界面
function demoApply(status: GitStatus, action: string, arg?: unknown): GitStatus {
  const s = structuredClone(status)
  const paths = (list: GitFileChange[], p: unknown) =>
    p === 'all' ? list : list.filter(f => (p as string[]).includes(f.path))
  if (action === 'stage') {
    const moved = [...paths(s.unstaged, arg), ...paths(s.untracked, arg)]
    s.unstaged = s.unstaged.filter(f => !moved.includes(f))
    s.untracked = s.untracked.filter(f => !moved.includes(f))
    s.staged = [
      ...s.staged.filter(f => !moved.some(m => m.path === f.path)),
      ...moved.map(f => ({ ...f, code: f.code === '?' ? ('A' as const) : f.code })),
    ]
  }
  if (action === 'unstage') {
    const moved = paths(s.staged, arg)
    s.staged = s.staged.filter(f => !moved.includes(f))
    s.unstaged = [...s.unstaged.filter(f => !moved.some(m => m.path === f.path)), ...moved.filter(f => f.code !== 'A')]
    s.untracked = [...s.untracked, ...moved.filter(f => f.code === 'A').map(f => ({ ...f, code: '?' as const }))]
  }
  if (action === 'discard') {
    const p =
      arg === 'all' ? 'all' : [...(arg as { paths: string[] }).paths, ...(arg as { untracked: string[] }).untracked]
    s.unstaged = s.unstaged.filter(f => !paths(s.unstaged, p).includes(f))
    s.untracked = s.untracked.filter(f => !paths(s.untracked, p).includes(f))
  }
  if (action === 'commit') {
    const all = (arg as { all: boolean }).all
    s.staged = []
    if (all) {
      s.unstaged = []
      s.untracked = []
    }
    s.ahead += 1
    if ((arg as { push: boolean }).push) s.ahead = 0
  }
  if (action === 'push') {
    s.ahead = 0
    s.upstream = s.upstream ?? `origin/${s.branch}`
  }
  if (action === 'pull') s.behind = 0
  if (action === 'fetch') s.fetchedAt = Date.now()
  if (action === 'switch') s.branch = (arg as string).replace(/^origin\//, '')
  return s
}

function GitBody({ target, demo, active }: { target: WorkspaceRef; demo: boolean; active: boolean }) {
  useI18n()
  const api = window.pixelsky?.projectTools
  const [status, setStatus] = useState<GitStatus | null>(demo ? structuredClone(demoData().git.status) : null)
  const [loadError, setLoadError] = useState('')
  const [failure, setFailure] = useState<GitFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<{ area: GitArea; path: string } | null>(null)
  const [menu, setMenu] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [now, setNow] = useState(Date.now)
  const authPaused = useRef(false)
  const last = useRef<(() => Promise<GitResult>) | null>(null)
  const busyRef = useRef(false)
  const remote = machineOf(target.sessionId ?? target.projectId) !== 'local'

  const refresh = useCallback(async () => {
    if (demo || !api) return
    try {
      setStatus(await api.gitStatus(target))
      setLoadError('')
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [demo])

  /** 运行一个写操作：同一时间只有一个；结果带回最新状态，失败显示原因卡片 */
  const perform = useCallback(
    async (fn: () => Promise<GitResult>, demoAction?: [string, unknown?]) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setFailure(null)
      try {
        if (demo) {
          if (demoAction) setStatus(s => s && demoApply(s, demoAction[0], demoAction[1]))
          return
        }
        last.current = fn
        const result = await fn()
        if (result.status) setStatus(result.status)
        if (!result.ok) setFailure(result.failure)
        else if (result.ok && authPaused.current) authPaused.current = false
      } catch (e) {
        setFailure({ kind: 'invalid', action: 'operation', detail: (e as Error).message, remedies: [] })
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [demo],
  )

  // 刷新：可见时每 15 秒、窗口回到前台、项目工具变化、AI 回合结束（去抖）
  useEffect(() => {
    if (!active || demo || !api) return
    void refresh()
    let timer = 0
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(), 400)
    }
    const poll = window.setInterval(() => {
      if (!busyRef.current) void refresh()
    }, POLL_MS)
    const offTools = api.onChange(soon)
    const offWindow = window.pixelsky!.window.onState(state => {
      if (state.focused) soon()
    })
    const offEngine = window.pixelsky!.engine.onEvent(e => {
      if (
        e.kind === 'session' &&
        (e.event.type === 'turn_completed' ||
          (e.event.type === 'item_completed' && e.event.item.kind === 'file_change'))
      )
        soon()
    })
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      offTools()
      offWindow()
      offEngine()
    }
  }, [active, refresh])

  // 自动检查远端：Git 页可见且窗口在前台时每 10 分钟；认证失败后暂停，手动检查成功后恢复
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now())
      if (!active || demo || !api || busyRef.current || authPaused.current || !document.hasFocus()) return
      if (
        !status?.repo ||
        !status.remotes.length ||
        (status.fetchedAt && Date.now() - status.fetchedAt < AUTO_FETCH_MS)
      )
        return
      busyRef.current = true
      void api
        .gitFetch(target)
        .then(
          r => {
            if (r.status) setStatus(r.status)
            if (!r.ok && (r.failure.kind === 'auth' || r.failure.kind === 'timeout')) authPaused.current = true
          },
          () => {},
        )
        .finally(() => {
          busyRef.current = false
        })
    }, 60_000)
    return () => window.clearInterval(tick)
  }, [active, status?.repo, status?.fetchedAt, status?.remotes.length])

  const pull = (mode: 'ff-only' | 'rebase' | 'stash') => perform(() => api!.gitPull(target, mode), ['pull'])
  const push = (publish: boolean) => perform(() => api!.gitPush(target, { publish }), ['push'])
  const fetch = () => perform(() => api!.gitFetch(target), ['fetch'])
  const openBranches = async () => {
    setMenu(true)
    if (demo) {
      setBranches(demoData().git.branches)
      return
    }
    setBranchesLoading(true)
    try {
      setBranches(await api!.gitBranches(target))
    } catch (e) {
      setFailure({ kind: 'invalid', action: 'switch', detail: (e as Error).message, remedies: [] })
    } finally {
      setBranchesLoading(false)
    }
  }

  // 命令面板：拉取 / 推送 / 检查远端 / 切换分支（Git 页可见且状态读到后执行）
  useEffect(() => {
    if (!active || !status?.repo) return
    const consume = () => {
      const action = pendingAction
      if (!action) return
      pendingAction = null
      if (action === 'pull') void pull('ff-only')
      else if (action === 'push') void push(!status.upstream)
      else if (action === 'fetch') void fetch()
      else void openBranches()
    }
    consume()
    window.addEventListener(GIT_ACTION_EVENT, consume)
    return () => window.removeEventListener(GIT_ACTION_EVENT, consume)
  })

  const remedy = (r: GitRemedy) => {
    if (r === 'retry' && last.current) void perform(last.current)
    else if (r === 'pullRebase') void pull('rebase')
    else if (r === 'pullStash') void pull('stash')
    else if (r === 'publish') void push(true)
    else if (r === 'abort') void perform(() => api!.gitOperation(target, 'abort'))
    else if (r === 'terminal') openRightTab('terminal')
  }

  const sections = useMemo(() => (status?.repo ? gitSections(status) : []), [status])
  const stage = (paths: string[] | 'all') => perform(() => api!.gitStage(target, paths), ['stage', paths])
  const unstage = (paths: string[] | 'all') => perform(() => api!.gitUnstage(target, paths), ['unstage', paths])
  const busyNote = status && status.busySessions > 0 ? <p className="mt-2 text-warn">{tr('git.confirm.busy')}</p> : null
  const discard = (input: { paths: string[]; untracked: string[] } | 'all', body: string) =>
    setConfirm({
      title: tr('git.confirm.discard.title'),
      body: (
        <>
          {body}
          {busyNote}
        </>
      ),
      label: tr('git.confirm.ok'),
      danger: true,
      run: () => void perform(() => api!.gitDiscard(target, input), ['discard', input]),
    })
  const discardFile = (file: GitFileChange, area: GitArea) => {
    const { name } = splitPath(file.path)
    if (area === 'untracked')
      discard(
        { paths: [], untracked: [file.path] },
        tr(remote ? 'git.confirm.delete.body' : 'git.confirm.trash.body', { name }),
      )
    else discard({ paths: [file.path], untracked: [] }, tr('git.confirm.discard.body', { name }))
  }
  const discardSection = (section: GitSection) => {
    if (section.area === 'untracked')
      discard(
        { paths: [], untracked: section.files.map(f => f.path) },
        tr('git.confirm.discardAll.body', { count: 0, untracked: section.files.length }),
      )
    else
      discard(
        { paths: section.files.map(f => f.path), untracked: [] },
        tr('git.confirm.discardAll.body', { count: section.files.length, untracked: 0 }),
      )
  }
  const commit = (andPush: boolean) => {
    if (!status || !message.trim()) return
    const run = (all: boolean) =>
      perform(async () => {
        const r = await api!.gitCommit(target, { message, all, push: andPush })
        if (r.ok) setMessage('')
        return r
      }, ['commit', { all, push: andPush }]).then(() => {
        if (demo) setMessage('')
      })
    if (needsCommitAll(status))
      setConfirm({
        title: tr('git.confirm.commitAll.title'),
        body: tr('git.confirm.commitAll.body', { count: status.unstaged.length + status.untracked.length }),
        label: tr(andPush ? 'git.commitAllPush' : 'git.commitAll'),
        danger: false,
        run: () => void run(true),
      })
    else void run(false)
  }

  if (!status)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-6 text-meta text-fg-muted">
        {loadError ? (
          <span className="text-danger">{loadError}</span>
        ) : (
          <>
            <Spinner size={13} />
            {tr('projectTools.loading')}
          </>
        )}
      </div>
    )
  if (status.missing || !status.repo)
    return (
      <div className="flex min-h-0 flex-1 p-3">
        <PanelCard>
          <EmptyState
            icon={GitBranch}
            title={tr(status.missing ? 'git.missing.title' : 'git.notRepo.title')}
            hint={tr(status.missing ? 'git.missing.hint' : 'git.notRepo.hint')}
          />
        </PanelCard>
      </div>
    )

  const selectedFile = selected
    ? sections.find(s => s.area === selected.area)?.files.find(f => f.path === selected.path)
    : undefined
  const fileActions = (file: GitFileChange, area: GitArea) => ({
    onOpen: file.local && file.code !== 'D' ? () => void openFile(target, file.local!) : undefined,
    onStage:
      area === 'unstaged' || area === 'untracked' || area === 'conflicted' ? () => void stage([file.path]) : undefined,
    onUnstage: area === 'staged' ? () => void unstage([file.path]) : undefined,
    onDiscard: area === 'unstaged' || area === 'untracked' ? () => discardFile(file, area) : undefined,
  })
  const overlay = confirm && (
    <ConfirmDialog
      title={confirm.title}
      description={confirm.body}
      confirmLabel={confirm.label}
      cancelLabel={tr('projectTools.cancel')}
      busy={busy}
      danger={confirm.danger}
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        const c = confirm
        setConfirm(null)
        c.run()
      }}
    />
  )

  if (selected && selectedFile) {
    return (
      <>
        <GitDiffView
          file={selectedFile}
          area={selected.area}
          busy={busy}
          {...fileActions(selectedFile, selected.area)}
          load={() =>
            demo
              ? Promise.resolve(demoData().git.diff(selectedFile.path))
              : api!.gitDiff(target, { path: selectedFile.path, area: selected.area, origPath: selectedFile.origPath })
          }
          onBack={() => setSelected(null)}
          onNeighbour={delta => {
            const next = neighbour(sections, selected.area, selected.path, delta)
            if (next) setSelected({ area: next.area, path: next.file.path })
          }}
        />
        {overlay}
      </>
    )
  }

  const total = changeCount(status)
  const canCommit = !!message.trim() && !busy && total > 0 && !status.conflicted.length
  const commitAll = needsCommitAll(status)
  return (
    <div data-git-panel className="flex min-h-0 flex-1 flex-col">
      {/* 顶部：分支、领先落后、拉取推送、远端检查 */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-line-subtle px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menu}
              onClick={() => (menu ? setMenu(false) : void openBranches())}
              disabled={busy}
              className="flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-list font-medium text-fg hover:bg-hover"
            >
              <GitBranch size={14} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 truncate">
                {status.detached ? tr('git.branch.detached', { hash: (status.head ?? '').slice(0, 7) }) : status.branch}
              </span>
              <ChevronDown size={13} className="shrink-0 text-fg-muted" />
            </button>
            {menu && (
              <BranchMenu
                branches={branches}
                loading={branchesLoading}
                onClose={() => setMenu(false)}
                onSwitch={b => {
                  setMenu(false)
                  void perform(() => api!.gitSwitch(target, { branch: b.name, remote: b.remote }), ['switch', b.name])
                }}
                onCreate={name => {
                  setMenu(false)
                  void perform(() => api!.gitCreateBranch(target, { name }), ['switch', name])
                }}
              />
            )}
          </div>
          {status.upstream && (status.ahead > 0 || status.behind > 0) && (
            <span className="flex shrink-0 items-center gap-1.5 text-meta text-fg-muted tabular-nums">
              {status.ahead > 0 && (
                <span title={tr('git.ahead', { n: status.ahead })} className="flex items-center">
                  <ArrowUp size={12} />
                  {status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span title={tr('git.behind', { n: status.behind })} className="flex items-center">
                  <ArrowDown size={12} />
                  {status.behind}
                </span>
              )}
            </span>
          )}
          <IconButton
            icon={RefreshCw}
            label={tr('git.refresh')}
            size={28}
            iconSize={14}
            disabled={busy}
            onClick={() => void refresh()}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            className="h-7 px-2.5 text-meta"
            icon={ArrowDown}
            disabled={busy || !status.upstream}
            onClick={() => void pull('ff-only')}
          >
            {tr('git.pull')}
          </Button>
          <Button
            className="h-7 px-2.5 text-meta"
            icon={ArrowUp}
            disabled={busy || status.detached || !status.remotes.length}
            onClick={() => void push(!status.upstream)}
          >
            {tr(status.upstream ? 'git.push' : 'git.publish')}
          </Button>
          <span className="min-w-0 flex-1 truncate text-right text-meta text-fg-faint">
            {!status.remotes.length
              ? tr('git.noRemoteShort')
              : status.fetchedAt
                ? tr('git.fetchedAt', { ago: ago(status.fetchedAt, now) })
                : tr('git.fetchedNever')}
          </span>
          {status.remotes.length > 0 && (
            <IconButton
              icon={CloudDownload}
              label={tr('git.fetch')}
              size={26}
              iconSize={14}
              disabled={busy}
              onClick={() => void fetch()}
            />
          )}
          {busy && <Spinner size={13} />}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {status.operation && (
          <div role="status" className="shrink-0 rounded-lg border border-warn/40 bg-surface p-2.5">
            <div className="flex items-center gap-2 text-list font-medium text-warn">
              <TriangleAlert size={14} />
              {tr(`git.operation.${status.operation}`)}
            </div>
            <p className="mt-1 text-meta text-fg-muted">{tr('git.operation.hint')}</p>
            <div className="mt-2 flex gap-1.5">
              <Button
                className="h-7 px-2.5 text-meta"
                disabled={busy}
                onClick={() => void perform(() => api!.gitOperation(target, 'abort'))}
              >
                {tr('git.operation.abort')}
              </Button>
              <Button
                variant="primary"
                className="h-7 px-2.5 text-meta"
                disabled={busy || status.conflicted.length > 0}
                onClick={() => void perform(() => api!.gitOperation(target, 'continue'))}
              >
                {tr('git.operation.continue')}
              </Button>
            </div>
          </div>
        )}
        {failure && (
          <div
            role="alert"
            data-git-failure={failure.kind}
            className="shrink-0 rounded-lg border border-danger/40 bg-surface p-2.5"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-meta text-fg-faint">{tr(`git.action.${failure.action}`)}</p>
                <p className="text-list font-medium text-danger">{failureTitle(failure.kind)}</p>
                <p className="mt-0.5 text-meta text-fg-muted">{failureHint(failure.kind)}</p>
              </div>
              <IconButton
                icon={X}
                label={tr('git.failure.dismiss')}
                size={24}
                iconSize={13}
                onClick={() => setFailure(null)}
              />
            </div>
            {failure.detail && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-meta text-fg-muted">{tr('git.failure.detail')}</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-secondary">
                  {failure.detail}
                </pre>
              </details>
            )}
            {failure.remedies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {failure.remedies.map((r, i) => (
                  <Button
                    key={r}
                    variant={i === 0 ? 'primary' : 'outline'}
                    className="h-7 px-2.5 text-meta"
                    disabled={busy}
                    onClick={() => remedy(r)}
                  >
                    {tr(`git.remedy.${r}`)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {status.busySessions > 0 && (
          <p className="shrink-0 rounded-md bg-subtle px-2.5 py-1.5 text-meta text-fg-muted">{tr('git.busy')}</p>
        )}

        {/* 提交 */}
        <div className="shrink-0">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={2}
            aria-label={tr('git.commit.label')}
            placeholder={tr('git.commit.placeholder')}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (canCommit) commit(false)
              }
            }}
            className="block max-h-40 min-h-14 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-list text-fg outline-none placeholder:text-fg-faint focus-visible:border-accent"
          />
          <div className="mt-1.5 flex gap-1.5">
            <Button
              variant="primary"
              className="h-7 flex-1 justify-center px-2.5 text-meta"
              disabled={!canCommit}
              onClick={() => commit(false)}
            >
              {tr(commitAll ? 'git.commitAll' : 'git.commit')}
            </Button>
            <Button
              className="h-7 flex-1 justify-center px-2.5 text-meta"
              disabled={!canCommit || !status.remotes.length || status.detached}
              onClick={() => commit(true)}
            >
              {tr(commitAll ? 'git.commitAllPush' : 'git.commitPush')}
            </Button>
          </div>
        </div>

        {total === 0 && (
          <div className="py-6 text-center">
            <p className="text-list text-fg-muted">{tr('git.clean')}</p>
            <p className="mt-1 text-meta text-fg-faint">{tr('git.cleanHint')}</p>
          </div>
        )}
        {status.truncated && <p className="shrink-0 text-meta text-warn">{tr('git.truncated')}</p>}
        {sections.map(section => (
          <section key={section.area} data-git-section={section.area} className="shrink-0">
            <div className="group/section flex h-7 items-center gap-1 pr-0.5">
              <h3
                className={cn(
                  'min-w-0 flex-1 truncate text-label font-medium',
                  section.area === 'conflicted' ? 'text-danger' : 'text-fg-muted',
                )}
              >
                {tr(section.title)} <span className="tabular-nums text-fg-faint">{section.files.length}</span>
              </h3>
              {section.area === 'staged' ? (
                <IconButton
                  icon={Minus}
                  label={tr('git.unstageAll')}
                  size={24}
                  iconSize={13}
                  disabled={busy}
                  onClick={() => void unstage('all')}
                />
              ) : (
                <>
                  {section.area !== 'conflicted' && (
                    <IconButton
                      icon={Undo2}
                      label={tr('git.discardAll')}
                      size={24}
                      iconSize={13}
                      disabled={busy}
                      onClick={() => discardSection(section)}
                    />
                  )}
                  <IconButton
                    icon={Plus}
                    label={tr('git.stageAll')}
                    size={24}
                    iconSize={13}
                    disabled={busy}
                    onClick={() => void stage(section.files.map(f => f.path))}
                  />
                </>
              )}
            </div>
            <ul className="flex flex-col">
              {section.files.map(file => {
                const { name, dir } = splitPath(file.path)
                const actions = fileActions(file, section.area)
                return (
                  <li
                    key={section.area + ':' + file.path}
                    className="group/file flex h-7 min-w-0 items-center gap-1 rounded-md pr-0.5 hover:bg-hover"
                  >
                    <button
                      type="button"
                      onClick={() => setSelected({ area: section.area, path: file.path })}
                      title={`${tr('git.viewDiff')} · ${file.origPath ? file.origPath + ' → ' : ''}${file.path}`}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left"
                    >
                      <span
                        className={cn(
                          'w-3 shrink-0 text-center font-mono text-[11px] font-semibold',
                          file.code === 'D'
                            ? 'text-danger'
                            : file.code === 'A' || file.code === '?'
                              ? 'text-success'
                              : file.code === 'U'
                                ? 'text-danger'
                                : 'text-warn',
                        )}
                      >
                        {file.code}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 truncate text-list',
                          file.code === 'D' ? 'text-fg-muted line-through' : 'text-fg',
                        )}
                      >
                        {name}
                      </span>
                      {dir && <span className="min-w-0 truncate text-meta text-fg-faint">{dir}</span>}
                    </button>
                    <span className="flex shrink-0 items-center opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100">
                      {actions.onOpen && (
                        <IconButton
                          icon={FileCode2}
                          label={tr('git.open')}
                          size={22}
                          iconSize={12}
                          onClick={actions.onOpen}
                        />
                      )}
                      {actions.onDiscard && (
                        <IconButton
                          icon={Undo2}
                          label={tr('git.discard')}
                          size={22}
                          iconSize={12}
                          disabled={busy}
                          onClick={actions.onDiscard}
                        />
                      )}
                      {actions.onStage && (
                        <IconButton
                          icon={Plus}
                          label={tr('git.stage')}
                          size={22}
                          iconSize={12}
                          disabled={busy}
                          onClick={actions.onStage}
                        />
                      )}
                      {actions.onUnstage && (
                        <IconButton
                          icon={Minus}
                          label={tr('git.unstage')}
                          size={22}
                          iconSize={12}
                          disabled={busy}
                          onClick={actions.onUnstage}
                        />
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      {overlay}
    </div>
  )
}
