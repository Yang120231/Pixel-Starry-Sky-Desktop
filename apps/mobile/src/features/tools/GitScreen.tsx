// Git（docs/mobile-remote.md §18.4）：分支和改动的文件、点开看改动；暂存 / 取消暂存、提交、推送（做之前确认）。
// 放弃改动、强制推送、删分支、改写历史都不在手机上做（§18.7）。
import { useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, Minus, Plus, Upload } from 'lucide-react'
import {
  GIT_CODE_TEXT,
  callTool,
  gitChangeCount,
  gitFailureText,
  toolError,
  useToolData,
  type GitArea,
  type GitFileChange,
  type GitDiffView,
  type GitResult,
  type GitStatus,
} from '@/data/tools'
import { Banner, Button, DiffView, Empty, Section, Spinner, cn } from '@/ui'
import { ConfirmSheet } from '@/ui/sheet'
import { Loading, PathRow, ToolFrame, type ToolProps } from './common'

interface DiffTarget {
  area: GitArea
  path: string
  origPath: string | null
}

const AREAS: readonly { area: GitArea; title: string }[] = [
  { area: 'conflicted', title: '冲突' },
  { area: 'staged', title: '已暂存' },
  { area: 'unstaged', title: '改动' },
  { area: 'untracked', title: '未跟踪' },
]

export function GitScreen(props: ToolProps) {
  const target = props.sub ? (JSON.parse(props.sub) as DiffTarget) : null
  return target ? <DiffPage tool={props} target={target} /> : <StatusPage tool={props} />
}

/** 暂存 / 提交 / 推送：一次只做一件，结果里带着最新状态 */
function useGitAction(tool: ToolProps, onStatus: (s: GitStatus) => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const run = async (label: string, method: string, arg: unknown, success?: string) => {
    setBusy(label)
    setError(null)
    setDone(null)
    try {
      const r = await callTool<GitResult>(tool.deviceId, method, { projectId: tool.project.id }, arg)
      if (r.status) onStatus(r.status)
      if (r.ok) {
        if (success) setDone(success)
        return true
      }
      setError(gitFailureText(r.failure))
    } catch (e) {
      setError(toolError(e))
    } finally {
      setBusy(null)
    }
    return false
  }
  return { busy, error, done, run }
}

function StatusPage({ tool }: { tool: ToolProps }) {
  const status = useToolData<GitStatus>(tool.deviceId, 'projectTools:gitStatus', [{ projectId: tool.project.id }], true)
  const action = useGitAction(tool, status.set)
  const [message, setMessage] = useState('')
  const [pushAfter, setPushAfter] = useState(false)
  const [confirm, setConfirm] = useState<'commit' | 'push' | null>(null)
  const s = status.data
  const count = s ? gitChangeCount(s) : 0
  const remote = s ? (s.upstream ?? (s.remotes.includes('origin') ? 'origin' : s.remotes[0])) : undefined
  const canPush = !!s && !s.detached && !s.initial && !!s.remotes.length && (s.ahead > 0 || !s.upstream)
  const disabled = !tool.canAct || !!action.busy

  const commit = async () => {
    const ok = await action.run(
      'commit',
      'projectTools:gitCommit',
      { message: message.trim(), all: !s?.staged.length, push: pushAfter },
      pushAfter ? '已提交并推送' : '已提交',
    )
    if (ok) setMessage('')
  }

  return (
    <ToolFrame
      tool={tool}
      title="Git"
      loading={status.loading}
      onRefresh={status.reload}
      footer={
        s?.repo &&
        tool.canAct && (
          <div className="flex flex-col gap-2 border-t border-line-subtle px-3 pt-2.5 pb-2">
            {count > 0 && (
              <>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={2}
                  placeholder="提交说明"
                  className="field-sizing-content max-h-32 min-h-11 w-full resize-none rounded-xl border border-line-composer bg-surface px-3 py-2.5 text-prose outline-none focus:border-line-composer-focus"
                />
                <div className="flex items-center gap-2">
                  <label className="flex min-h-10 flex-1 items-center gap-2 text-meta text-fg-secondary">
                    <input
                      type="checkbox"
                      checked={pushAfter}
                      disabled={!s.remotes.length || s.detached}
                      onChange={e => setPushAfter(e.target.checked)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    提交后推送
                  </label>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={disabled || !message.trim() || !!s.conflicted.length}
                    onClick={() => setConfirm('commit')}
                  >
                    {action.busy === 'commit' && <Spinner size={13} />}
                    {s.staged.length ? `提交 ${s.staged.length} 个文件` : `提交全部改动（${count}）`}
                  </Button>
                </div>
              </>
            )}
            {canPush && (
              <Button disabled={disabled} onClick={() => setConfirm('push')} className="w-full">
                {action.busy === 'push' ? <Spinner size={15} /> : <Upload size={17} />}
                {s.upstream ? `推送 ${s.ahead} 个提交` : `发布分支到 ${remote}`}
              </Button>
            )}
          </div>
        )
      }
    >
      {!s ? (
        <Loading error={status.error} />
      ) : s.missing ? (
        <Empty icon={GitBranch} title="电脑上没有找到 Git" body="安装 Git 后再试。" />
      ) : !s.repo ? (
        <Empty icon={GitBranch} title="不是 Git 仓库" body="这个项目还没有用 Git 管理。" />
      ) : (
        <div className="flex flex-col gap-5 pt-1 pb-6">
          {status.error && <Banner tone="danger">{status.error}</Banner>}
          {action.error && (
            <Banner tone="danger">
              <span className="whitespace-pre-wrap">{action.error}</span>
            </Banner>
          )}
          {action.done && <Banner>{action.done}</Banner>}
          <Section>
            <div className="flex min-h-14 items-center gap-3 px-4 py-3">
              <GitBranch size={20} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-ui">
                  {s.detached ? '分离 HEAD' : (s.branch ?? '（没有分支）')}
                </span>
                <span className="truncate text-meta text-fg-muted">
                  {s.initial ? '还没有提交' : s.upstream ? `跟踪 ${s.upstream}` : '没有上游分支'}
                </span>
              </span>
              {(s.ahead > 0 || s.behind > 0) && (
                <span className="flex shrink-0 items-center gap-2 font-mono text-meta text-fg-secondary">
                  {s.ahead > 0 && (
                    <span className="flex items-center">
                      <ArrowUp size={13} />
                      {s.ahead}
                    </span>
                  )}
                  {s.behind > 0 && (
                    <span className="flex items-center">
                      <ArrowDown size={13} />
                      {s.behind}
                    </span>
                  )}
                </span>
              )}
            </div>
          </Section>
          {s.operation && <Banner tone="warn">正在进行 {s.operation}，请到电脑上完成或中止。</Banner>}
          {s.busySessions > 0 && <Banner tone="warn">AI 正在这个工作区运行，它可能还在改文件。</Banner>}
          {s.behind > 0 && <Banner>远端有 {s.behind} 个新提交，拉取请到电脑上做。</Banner>}
          {count === 0 && <Empty icon={GitBranch} title="没有改动" body="工作区是干净的。" />}
          {AREAS.map(({ area, title }) => {
            const files = s[area]
            if (!files.length) return null
            const staged = area === 'staged'
            return (
              <Section
                key={area}
                title={
                  <>
                    {title}
                    <span className="text-fg-faint">{files.length}</span>
                  </>
                }
                trailing={
                  tool.canAct &&
                  area !== 'conflicted' && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        void action.run(
                          'stage',
                          staged ? 'projectTools:gitUnstage' : 'projectTools:gitStage',
                          staged ? 'all' : files.map(f => f.path),
                        )
                      }
                      className="text-meta text-accent-fg disabled:opacity-40"
                    >
                      {staged ? '全部取消暂存' : '全部暂存'}
                    </button>
                  )
                }
              >
                {files.map((f, i) => (
                  <FileRow
                    key={f.path}
                    file={f}
                    area={area}
                    first={i === 0}
                    canAct={tool.canAct && area !== 'conflicted'}
                    busy={disabled}
                    onOpen={() =>
                      tool.onSub(JSON.stringify({ area, path: f.path, origPath: f.origPath } satisfies DiffTarget))
                    }
                    onStage={() =>
                      void action.run('stage', staged ? 'projectTools:gitUnstage' : 'projectTools:gitStage', [f.path])
                    }
                  />
                ))}
              </Section>
            )
          })}
          {s.truncated && <p className="px-5 text-label text-fg-faint">改动太多，只列出了前 5000 项。</p>}
        </div>
      )}
      {confirm && s && (
        <ConfirmSheet
          title={confirm === 'commit' ? `提交到 ${s.branch ?? '当前分支'}` : '推送'}
          confirm={confirm === 'commit' ? (pushAfter ? '提交并推送' : '提交') : '推送'}
          onConfirm={() =>
            void (confirm === 'commit'
              ? commit()
              : action.run('push', 'projectTools:gitPush', { publish: !s.upstream }, '已推送'))
          }
          onClose={() => setConfirm(null)}
        >
          {confirm === 'commit' ? (
            <CommitSummary status={s} message={message.trim()} push={pushAfter ? remote : undefined} />
          ) : (
            <p>
              {s.upstream
                ? `把 ${s.branch} 的 ${s.ahead} 个提交推送到 ${s.upstream}。`
                : `把 ${s.branch} 发布到 ${remote}，并设为上游分支。`}
            </p>
          )}
        </ConfirmSheet>
      )}
    </ToolFrame>
  )
}

function CommitSummary({ status, message, push }: { status: GitStatus; message: string; push?: string }) {
  const files = status.staged.length
    ? status.staged
    : [...status.unstaged, ...status.untracked].filter((f, i, all) => all.findIndex(x => x.path === f.path) === i)
  return (
    <div className="flex flex-col gap-2.5">
      <p className="rounded-lg bg-subtle px-3 py-2 whitespace-pre-wrap text-fg">{message}</p>
      <p>
        {status.staged.length ? '提交已暂存的' : '暂存并提交全部'} {files.length} 个文件：
      </p>
      <ul className="flex flex-col gap-0.5 font-mono text-label">
        {files.slice(0, 20).map(f => (
          <li key={f.path} className="truncate">
            {f.code === '?' ? 'A' : f.code} {f.path}
          </li>
        ))}
        {files.length > 20 && <li>…等 {files.length} 个</li>}
      </ul>
      {push && <p>提交后推送到 {push}。</p>}
    </div>
  )
}

function FileRow({
  file,
  area,
  first,
  canAct,
  busy,
  onOpen,
  onStage,
}: {
  file: GitFileChange
  area: GitArea
  first: boolean
  canAct: boolean
  busy: boolean
  onOpen(): void
  onStage(): void
}) {
  const staged = area === 'staged'
  return (
    <PathRow
      path={file.path}
      first={first}
      onClick={file.submodule ? undefined : onOpen}
      icon={
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-label font-semibold',
            file.code === 'D'
              ? 'bg-subtle text-danger'
              : file.code === 'U'
                ? 'bg-subtle text-warn'
                : 'bg-subtle text-success',
          )}
          title={GIT_CODE_TEXT[file.code]}
        >
          {file.code === '?' ? 'U' : file.code}
        </span>
      }
      badge={file.origPath ? <span className="truncate text-label text-fg-faint">← {file.origPath}</span> : null}
      trailing={
        canAct && (
          <button
            type="button"
            aria-label={staged ? `取消暂存 ${file.path}` : `暂存 ${file.path}`}
            disabled={busy}
            onClick={onStage}
            className="flex size-10 items-center justify-center rounded-full text-fg-muted active:bg-hover disabled:opacity-40"
          >
            {staged ? <Minus size={18} /> : <Plus size={18} />}
          </button>
        )
      }
    />
  )
}

function DiffPage({ tool, target }: { tool: ToolProps; target: DiffTarget }) {
  const diff = useToolData<GitDiffView>(tool.deviceId, 'projectTools:gitDiff', [
    { projectId: tool.project.id },
    { path: target.path, area: target.area, ...(target.origPath ? { origPath: target.origPath } : {}) },
  ])
  const action = useGitAction(tool, () => tool.onBack())
  const d = diff.data
  const staged = target.area === 'staged'
  return (
    <ToolFrame
      tool={tool}
      title={target.path.split('/').pop()}
      subtitle={
        <span className="font-mono">
          {AREAS.find(a => a.area === target.area)?.title} · {target.path}
        </span>
      }
      loading={diff.loading}
      onRefresh={diff.reload}
      footer={
        tool.canAct &&
        target.area !== 'conflicted' && (
          <div className="border-t border-line-subtle p-3">
            <Button
              className="w-full"
              disabled={!!action.busy}
              onClick={() =>
                void action.run('stage', staged ? 'projectTools:gitUnstage' : 'projectTools:gitStage', [target.path])
              }
            >
              {action.busy ? <Spinner size={15} /> : staged ? <Minus size={17} /> : <Plus size={17} />}
              {staged ? '取消暂存这个文件' : '暂存这个文件'}
            </Button>
          </div>
        )
      }
    >
      {action.error && <Banner tone="danger">{action.error}</Banner>}
      {!d ? (
        <Loading error={diff.error} />
      ) : d.binary ? (
        <Empty icon={GitBranch} title="二进制文件" body="不能按行比较。" />
      ) : d.tooLarge ? (
        <Empty icon={GitBranch} title="文件太大" body="超过 2 MB，请到电脑上看。" />
      ) : (
        <div className="flex flex-col gap-2 pb-6">
          <div className="flex items-center gap-3 px-4 pt-2 font-mono text-meta">
            <span className="text-success">+{d.added}</span>
            <span className="text-danger">−{d.removed}</span>
          </div>
          <div className="mx-3 overflow-hidden rounded-xl border border-line-subtle bg-surface">
            <DiffView diff={d.diff} />
          </div>
          {d.cut && <p className="px-5 text-label text-fg-faint">改动太多，只显示了前面一部分，完整的请到电脑上看。</p>}
        </div>
      )}
    </ToolFrame>
  )
}
