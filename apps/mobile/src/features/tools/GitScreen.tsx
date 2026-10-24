// Git（docs/mobile-remote.md §18.4）：分支和改动的文件、点开看改动；暂存 / 取消暂存、提交、推送（做之前确认）。
// 放弃改动、强制推送、删分支、改写历史都不在手机上做（§18.7）。
import { useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, Minus, Plus, Upload } from 'lucide-react'
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
import { Loading, PathRow, ToolFrame, type ToolProps } from './common'

interface DiffTarget {
  area: GitArea
  path: string
  origPath: string | null
}

const areas = (): readonly { area: GitArea; title: string }[] => [
  { area: 'conflicted', title: L('冲突', 'Conflicts') },
  { area: 'staged', title: L('已暂存', 'Staged') },
  { area: 'unstaged', title: L('改动', 'Changes') },
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
      pushAfter ? L('已提交并推送', 'Committed and pushed') : L('已提交', 'Committed'),
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
                  placeholder={L('提交说明', 'Commit message')}
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
                    {L('提交后推送', 'Push after commit')}
                  </label>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={disabled || !message.trim() || !!s.conflicted.length}
                    onClick={() => setConfirm('commit')}
                  >
                    {action.busy === 'commit' && <Spinner size={13} />}
                    {s.staged.length
                      ? L(
                          `提交 ${s.staged.length} 个文件`,
                          `Commit ${s.staged.length} ${s.staged.length === 1 ? 'file' : 'files'}`,
                        )
                      : L(`提交全部改动（${count}）`, `Commit all changes (${count})`)}
                  </Button>
                </div>
              </>
            )}
            {canPush && (
              <Button disabled={disabled} onClick={() => setConfirm('push')} className="w-full">
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
                  {s.detached ? L('分离 HEAD', 'Detached HEAD') : (s.branch ?? L('（没有分支）', '(no branch)'))}
                </span>
                <span className="truncate text-meta text-fg-muted">
                  {s.initial
                    ? L('还没有提交', 'No commits yet')
                    : s.upstream
                      ? L(`跟踪 ${s.upstream}`, `Tracking ${s.upstream}`)
                      : L('没有上游分支', 'No upstream branch')}
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
          title={gitCodeText()[file.code]}
        >
          {file.code === '?' ? 'U' : file.code}
        </span>
      }
      badge={file.origPath ? <span className="truncate text-label text-fg-faint">← {file.origPath}</span> : null}
      trailing={
        canAct && (
          <button
            type="button"
            aria-label={
              staged ? L(`取消暂存 ${file.path}`, `Unstage ${file.path}`) : L(`暂存 ${file.path}`, `Stage ${file.path}`)
            }
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
          {areas().find(a => a.area === target.area)?.title} · {target.path}
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
