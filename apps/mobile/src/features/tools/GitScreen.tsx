// Git（docs/mobile-remote.md §18.4、§26）：大标题是项目名，下面一行分支 · ↑↓；改动的文件按「已暂存 / 没暂存…」分组，
// 每行一个着色的状态角标 + 等宽路径，点开看改动；底部一张提交卡片（说明、全部暂存、提交）；暂存 / 取消暂存、提交、推送（做之前确认）。
// 放弃改动、强制推送、删分支、改写历史都不在手机上做（§18.7）。
import { useState } from 'react'
import { GitBranch, Minus, Plus, Upload } from 'lucide-react'
import {
  callTool,
  gitCodeText,
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
import { L } from '@/i18n'
import { Banner, Button, DiffView, Empty, Section, Spinner, cn } from '@/ui'
import { ConfirmSheet } from '@/ui/sheet'
import { Loading, ToolFrame, type ToolProps } from './common'

interface DiffTarget {
  area: GitArea
  path: string
  origPath: string | null
}

const areas = (): readonly { area: GitArea; title: string }[] => [
  { area: 'conflicted', title: L('冲突', 'Conflicts') },
  { area: 'staged', title: L('已暂存', 'Staged') },
  { area: 'unstaged', title: L('没暂存', 'Unstaged') },
  { area: 'untracked', title: L('未跟踪', 'Untracked') },
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

/** 写操作返回的状态不带增删行数：同一区里没变的文件沿用上一份的，换了区的等随后的刷新补上 */
function keepCounts(next: GitStatus, prev: GitStatus | null): GitStatus {
  if (!prev) return next
  const carry = (area: 'staged' | 'unstaged') => {
    const old = new Map(prev[area].map(f => [f.path, f]))
    return next[area].map(f => {
      const o = old.get(f.path)
      return o && typeof o.insertions === 'number' ? { ...f, insertions: o.insertions, deletions: o.deletions } : f
    })
  }
  return { ...next, staged: carry('staged'), unstaged: carry('unstaged') }
}

function StatusPage({ tool }: { tool: ToolProps }) {
  const status = useToolData<GitStatus>(tool.deviceId, 'projectTools:gitStatus', [{ projectId: tool.project.id }], true)
  const action = useGitAction(tool, next => status.set(keepCounts(next, status.data)))
  const [message, setMessage] = useState('')
  const [pushAfter, setPushAfter] = useState(false)
  const [confirm, setConfirm] = useState<'commit' | 'push' | null>(null)
  const s = status.data
  const count = s ? gitChangeCount(s) : 0
  const remote = s ? (s.upstream ?? (s.remotes.includes('origin') ? 'origin' : s.remotes[0])) : undefined
  const canPush = !!s && !s.detached && !s.initial && !!s.remotes.length && (s.ahead > 0 || !s.upstream)
  const disabled = !tool.canAct || !!action.busy
  // 「全部暂存」：没暂存的和未跟踪的一起（冲突的要先在电脑上解决）
  const unstagedPaths = s ? [...s.unstaged, ...s.untracked].map(f => f.path) : []

  const commit = async () => {
    const ok = await action.run(
      'commit',
      'projectTools:gitCommit',
      { message: message.trim(), all: !s?.staged.length, push: pushAfter },
      pushAfter ? L('已提交并推送', 'Committed and pushed') : L('已提交', 'Committed'),
    )
    if (ok) setMessage('')
  }

  return (
    <ToolFrame
      tool={tool}
      title="Git"
      heading={tool.project.name}
      crumb={
        s?.repo && (
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch size={14} className="shrink-0" />
            <span className="truncate">
              <span className="font-mono">
                {s.detached ? L('分离 HEAD', 'Detached HEAD') : (s.branch ?? L('（没有分支）', '(no branch)'))}
              </span>
              {s.upstream && ` → ${s.upstream}`}
              {s.ahead > 0 && ` · ↑${s.ahead}`}
              {s.behind > 0 && ` ↓${s.behind}`}
              {s.initial
                ? ` · ${L('还没有提交', 'No commits yet')}`
                : !s.upstream && ` · ${L('没有上游分支', 'No upstream branch')}`}
            </span>
          </span>
        )
      }
      loading={status.loading}
      onRefresh={status.reload}
      footer={
        s?.repo &&
        tool.canAct &&
        (count > 0 || canPush) && (
          <div className="flex flex-col gap-2 px-4 pt-1 pb-2">
            {count > 0 && (
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={2}
                  placeholder={L('提交说明', 'Commit message')}
                  className="field-sizing-content max-h-32 min-h-11 w-full resize-none bg-transparent text-prose outline-none"
                />
                <label className="flex min-h-9 items-center gap-2 text-meta text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={pushAfter}
                    disabled={!s.remotes.length || s.detached}
                    onChange={e => setPushAfter(e.target.checked)}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  {L('提交后推送', 'Push after commit')}
                </label>
                <div className="flex gap-2">
                  {unstagedPaths.length > 0 && (
                    <Button
                      className="rounded-full! min-h-11! px-4!"
                      disabled={disabled}
                      onClick={() => void action.run('stage', 'projectTools:gitStage', unstagedPaths)}
                    >
                      {action.busy === 'stage' && <Spinner size={13} />}
                      {L('全部暂存', 'Stage all')}
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    className="min-w-0 flex-1 rounded-full! min-h-11! px-4!"
                    disabled={disabled || !message.trim() || !!s.conflicted.length}
                    onClick={() => setConfirm('commit')}
                  >
                    {action.busy === 'commit' && <Spinner size={13} />}
                    <span className="truncate">
                      {s.staged.length
                        ? L(
                            `提交 ${s.staged.length} 个文件`,
                            `Commit ${s.staged.length} ${s.staged.length === 1 ? 'file' : 'files'}`,
                          )
                        : L(`提交全部改动（${count}）`, `Commit all changes (${count})`)}
                    </span>
                  </Button>
                </div>
              </div>
            )}
            {canPush && (
              <Button disabled={disabled} onClick={() => setConfirm('push')} className="w-full rounded-full! min-h-11!">
                {action.busy === 'push' ? <Spinner size={15} /> : <Upload size={17} />}
                {s.upstream
                  ? L(`推送 ${s.ahead} 个提交`, `Push ${s.ahead} ${s.ahead === 1 ? 'commit' : 'commits'}`)
                  : L(`发布分支到 ${remote}`, `Publish branch to ${remote}`)}
              </Button>
            )}
          </div>
        )
      }
    >
      {!s ? (
        <Loading error={status.error} />
      ) : s.missing ? (
        <Empty
          icon={GitBranch}
          title={L('电脑上没有找到 Git', 'Git not found on the computer')}
          body={L('安装 Git 后再试。', 'Install Git and try again.')}
        />
      ) : !s.repo ? (
        <Empty
          icon={GitBranch}
          title={L('不是 Git 仓库', 'Not a Git repository')}
          body={L('这个项目还没有用 Git 管理。', 'This project isn’t managed with Git yet.')}
        />
      ) : (
        <div className="flex flex-col gap-4 pt-1 pb-6">
          {status.error && <Banner tone="danger">{status.error}</Banner>}
          {action.error && (
            <Banner tone="danger">
              <span className="whitespace-pre-wrap">{action.error}</span>
            </Banner>
          )}
          {action.done && <Banner>{action.done}</Banner>}
          {s.operation && (
            <Banner tone="warn">
              {L(
                `正在进行 ${s.operation}，请到电脑上完成或中止。`,
                `A ${s.operation} is in progress. Finish or abort it on your computer.`,
              )}
            </Banner>
          )}
          {s.busySessions > 0 && (
            <Banner tone="warn">
              {L(
                'AI 正在这个工作区运行，它可能还在改文件。',
                'AI is running in this workspace and may still be editing files.',
              )}
            </Banner>
          )}
          {s.behind > 0 && (
            <Banner>
              {L(
                `远端有 ${s.behind} 个新提交，拉取请到电脑上做。`,
                `The remote has ${s.behind} new ${s.behind === 1 ? 'commit' : 'commits'}. Pull on your computer.`,
              )}
            </Banner>
          )}
          {count === 0 && (
            <Empty
              icon={GitBranch}
              title={L('没有改动', 'No changes')}
              body={L('工作区是干净的。', 'The working tree is clean.')}
            />
          )}
          {areas().map(({ area, title }) => {
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
                      {staged ? L('全部取消暂存', 'Unstage all') : L('全部暂存', 'Stage all')}
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
          {s.truncated && (
            <p className="px-5 text-label text-fg-faint">
              {L('改动太多，只列出了前 5000 项。', 'Too many changes. Only the first 5000 are listed.')}
            </p>
          )}
        </div>
      )}
      {confirm && s && (
        <ConfirmSheet
          title={
            confirm === 'commit'
              ? L(`提交到 ${s.branch ?? '当前分支'}`, `Commit to ${s.branch ?? 'current branch'}`)
              : L('推送', 'Push')
          }
          confirm={
            confirm === 'commit'
              ? pushAfter
                ? L('提交并推送', 'Commit and push')
                : L('提交', 'Commit')
              : L('推送', 'Push')
          }
          onConfirm={() =>
            void (confirm === 'commit'
              ? commit()
              : action.run('push', 'projectTools:gitPush', { publish: !s.upstream }, L('已推送', 'Pushed')))
          }
          onClose={() => setConfirm(null)}
        >
          {confirm === 'commit' ? (
            <CommitSummary status={s} message={message.trim()} push={pushAfter ? remote : undefined} />
          ) : (
            <p>
              {s.upstream
                ? L(
                    `把 ${s.branch} 的 ${s.ahead} 个提交推送到 ${s.upstream}。`,
                    `Push ${s.ahead} ${s.ahead === 1 ? 'commit' : 'commits'} on ${s.branch} to ${s.upstream}.`,
                  )
                : L(
                    `把 ${s.branch} 发布到 ${remote}，并设为上游分支。`,
                    `Publish ${s.branch} to ${remote} and set it as the upstream branch.`,
                  )}
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
        {status.staged.length
          ? L(
              `提交已暂存的 ${files.length} 个文件：`,
              `Commit ${files.length} staged ${files.length === 1 ? 'file' : 'files'}:`,
            )
          : L(
              `暂存并提交全部 ${files.length} 个文件：`,
              `Stage and commit all ${files.length} ${files.length === 1 ? 'file' : 'files'}:`,
            )}
      </p>
      <ul className="flex flex-col gap-0.5 font-mono text-label">
        {files.slice(0, 20).map(f => (
          <li key={f.path} className="truncate">
            {f.code === '?' ? 'A' : f.code} {f.path}
          </li>
        ))}
        {files.length > 20 && <li>{L(`…等 ${files.length} 个`, `…${files.length} in total`)}</li>}
      </ul>
      {push && <p>{L(`提交后推送到 ${push}。`, `Then push to ${push}.`)}</p>}
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
  const badge = file.code === '?' ? 'U' : file.code
  return (
    <div className={cn('flex items-center', !first && 'border-t border-line')}>
      <button
        type="button"
        onClick={file.submodule ? undefined : onOpen}
        disabled={file.submodule}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-2 pl-4 text-left active:bg-hover"
      >
        {/* 状态角标：低透明度底色 + 同色字（改 = 暖色，新增 = 绿，删除 / 冲突 = 红，其余 = 灰） */}
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-label font-semibold',
            file.code === 'D' || file.code === 'U'
              ? 'bg-danger/15 text-danger'
              : file.code === 'A' || file.code === '?'
                ? 'bg-success/15 text-success'
                : file.code === 'M'
                  ? 'bg-warn/15 text-warn'
                  : 'bg-hover text-fg-muted',
          )}
          title={gitCodeText()[file.code]}
        >
          {badge}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-meta text-fg">{file.path}</span>
          {file.origPath && <span className="truncate font-mono text-label text-fg-faint">← {file.origPath}</span>}
          {typeof file.insertions === 'number' && (
            <span className="flex gap-2 font-mono text-label">
              <span className="text-success">+{file.insertions}</span>
              <span className="text-danger">−{file.deletions ?? 0}</span>
            </span>
          )}
        </span>
      </button>
      {canAct && (
        <button
          type="button"
          aria-label={
            staged ? L(`取消暂存 ${file.path}`, `Unstage ${file.path}`) : L(`暂存 ${file.path}`, `Stage ${file.path}`)
          }
          disabled={busy}
          onClick={onStage}
          className="mr-1 flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted active:bg-hover disabled:opacity-40"
        >
          {staged ? <Minus size={18} /> : <Plus size={18} />}
        </button>
      )}
    </div>
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
          {areas().find(a => a.area === target.area)?.title} · {target.path}
        </span>
      }
      loading={diff.loading}
      onRefresh={diff.reload}
      footer={
        tool.canAct &&
        target.area !== 'conflicted' && (
          <div className="px-4 pt-1 pb-2">
            <Button
              className="w-full rounded-full! min-h-11!"
              disabled={!!action.busy}
              onClick={() =>
                void action.run('stage', staged ? 'projectTools:gitUnstage' : 'projectTools:gitStage', [target.path])
              }
            >
              {action.busy ? <Spinner size={15} /> : staged ? <Minus size={17} /> : <Plus size={17} />}
              {staged ? L('取消暂存这个文件', 'Unstage this file') : L('暂存这个文件', 'Stage this file')}
            </Button>
          </div>
        )
      }
    >
      {action.error && <Banner tone="danger">{action.error}</Banner>}
      {!d ? (
        <Loading error={diff.error} />
      ) : d.binary ? (
        <Empty
          icon={GitBranch}
          title={L('二进制文件', 'Binary file')}
          body={L('不能按行比较。', 'Can’t compare line by line.')}
        />
      ) : d.tooLarge ? (
        <Empty
          icon={GitBranch}
          title={L('文件太大', 'File too large')}
          body={L('超过 2 MB，请到电脑上看。', 'Over 2 MB. View it on your computer.')}
        />
      ) : (
        <div className="flex flex-col gap-2 pb-6">
          <div className="flex items-center gap-3 px-4 pt-2 font-mono text-meta">
            <span className="text-success">+{d.added}</span>
            <span className="text-danger">−{d.removed}</span>
          </div>
          <div className="mx-3 overflow-hidden rounded-xl border border-line-subtle bg-surface">
            <DiffView diff={d.diff} />
          </div>
          {d.cut && (
            <p className="px-5 text-label text-fg-faint">
              {L(
                '改动太多，只显示了前面一部分，完整的请到电脑上看。',
                'Too many changes. Only the first part is shown; view the full diff on your computer.',
              )}
            </p>
          )}
        </div>
      )}
    </ToolFrame>
  )
}
