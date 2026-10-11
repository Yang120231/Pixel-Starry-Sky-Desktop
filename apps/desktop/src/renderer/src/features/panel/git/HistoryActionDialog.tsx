// 历史里会改动仓库的操作的确认框（docs/ui/git-panel.md §9.6 第二期）：检出、cherry-pick、revert、reset、新建标签、
// 检出分支、删除分支 / 标签。每一步都确认；动工作区的操作在 AI 运行时不能确认。
import { useState } from 'react'
import { cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import type { GitCommit, GitStatus } from '../../../../../shared/types/project-tools'
import { failureHint, failureTitle } from './gitModel'
import { shortHash } from './historyModel'

export type PendingAction =
  | { kind: 'checkout' | 'cherryPick' | 'revert' | 'reset' | 'tag'; commit: GitCommit }
  | { kind: 'switch'; name: string; remote: boolean }
  | { kind: 'deleteBranch' | 'deleteTag'; name: string }

export type ResetMode = 'soft' | 'mixed' | 'hard'
export interface ActionOptions {
  mode: ResetMode
  tagName: string
  message: string
  force: boolean
}
/** 运行结果：null 成功（或已交给面板的失败卡片）；'unmerged' 分支没合并，可以仍然删除；其余是错误文字 */
export type ActionOutcome = null | 'unmerged' | string

/** 会动工作区的操作：AI 在这个工作区运行时不能做 */
export const touchesWorktree = (kind: PendingAction['kind']): boolean =>
  kind === 'checkout' || kind === 'cherryPick' || kind === 'revert' || kind === 'reset' || kind === 'switch'

/** 已跟踪文件里有未提交改动的个数（暂存和未暂存合并，同一个文件算一次） */
export const dirtyCount = (status: GitStatus): number =>
  new Set([...status.staged, ...status.unstaged, ...status.conflicted].map(f => f.path)).size

export function HistoryActionDialog({
  action,
  status,
  onRun,
  onCancel,
}: {
  action: PendingAction
  status: GitStatus
  onRun: (options: ActionOptions) => Promise<ActionOutcome>
  onCancel: () => void
}) {
  useI18n()
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [tagName, setTagName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unmerged, setUnmerged] = useState(false)
  const kind = action.kind
  const blocked = touchesWorktree(kind) && status.busySessions > 0
  const dirty = dirtyCount(status)
  const branch = status.branch ?? tr('git.branch.detached', { hash: shortHash(status.head ?? '') })
  const commit = 'commit' in action ? action.commit : null
  const hash = commit ? shortHash(commit.hash) : ''
  const merge = !!commit && commit.parents.length > 1

  const submit = async () => {
    if (busy || blocked || (kind === 'tag' && !tagName.trim())) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await onRun({ mode, tagName: tagName.trim(), message, force: unmerged })
      if (outcome === 'unmerged') setUnmerged(true)
      else setError(outcome)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const name = 'name' in action ? action.name : ''
  const body =
    kind === 'checkout'
      ? tr('git.history.confirm.checkout.body', { hash })
      : kind === 'cherryPick' || kind === 'revert'
        ? tr(`git.history.confirm.${kind}.body`, { hash, subject: commit!.subject, branch })
        : kind === 'reset'
          ? tr('git.history.confirm.reset.body', { hash, branch })
          : kind === 'tag'
            ? tr('git.history.confirm.tag.body', { hash })
            : tr(`git.history.confirm.${kind}.body`, { name })
  const inputClass =
    'mt-2 w-full rounded-md border border-line bg-surface px-2.5 text-list text-fg outline-none focus-visible:border-accent'
  return (
    <ConfirmDialog
      title={tr(`git.history.confirm.${kind}.title`)}
      description={
        <div data-history-action={kind}>
          <p>{body}</p>
          {merge && (kind === 'cherryPick' || kind === 'revert') && (
            <p className="mt-1 text-fg-muted">{tr('git.history.mergeParent')}</p>
          )}
          {kind === 'reset' && (
            <fieldset className="mt-2">
              <legend className="mb-1 text-fg-muted">{tr('git.history.confirm.reset.mode')}</legend>
              {(['soft', 'mixed', 'hard'] as const).map(m => (
                <label key={m} className="flex h-7 cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="reset-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="accent-[var(--accent)]"
                  />
                  <span className={cn(m === 'hard' && 'text-danger')}>{tr(`git.history.confirm.reset.${m}`)}</span>
                </label>
              ))}
              {mode === 'hard' && (
                <p className={cn('mt-1', dirty ? 'font-medium text-danger' : 'text-fg-muted')}>
                  {dirty
                    ? tr('git.history.confirm.reset.hardWarn', { n: dirty })
                    : tr('git.history.confirm.reset.hardClean')}
                </p>
              )}
            </fieldset>
          )}
          {kind === 'tag' && (
            <>
              <input
                value={tagName}
                onChange={e => setTagName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                aria-label={tr('git.history.confirm.tag.name')}
                placeholder={tr('git.history.confirm.tag.name')}
                className={cn(inputClass, 'h-8')}
              />
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={2}
                aria-label={tr('git.history.confirm.tag.message')}
                placeholder={tr('git.history.confirm.tag.message')}
                className={cn(inputClass, 'resize-y py-1.5')}
              />
            </>
          )}
          {touchesWorktree(kind) && kind !== 'reset' && dirty > 0 && !blocked && (
            <p className="mt-1 text-fg-muted">{tr('git.history.dirty', { n: dirty })}</p>
          )}
          {blocked && <p className="mt-2 text-warn">{tr('git.history.busy')}</p>}
          {unmerged && (
            <div className="mt-2 rounded-md border border-danger/40 p-2">
              <p className="font-medium text-danger">{failureTitle('unmerged')}</p>
              <p className="mt-0.5 text-fg-muted">{failureHint('unmerged')}</p>
            </div>
          )}
        </div>
      }
      confirmLabel={tr(unmerged ? 'git.history.confirm.deleteBranch.force' : `git.history.confirm.${kind}.ok`)}
      cancelLabel={tr('projectTools.cancel')}
      busy={busy}
      error={error}
      danger={unmerged || kind === 'deleteBranch' || kind === 'deleteTag' || (kind === 'reset' && mode === 'hard')}
      focusInput={kind === 'tag'}
      confirmDisabled={blocked || (kind === 'tag' && !tagName.trim())}
      onCancel={onCancel}
      onConfirm={() => void submit()}
    />
  )
}
