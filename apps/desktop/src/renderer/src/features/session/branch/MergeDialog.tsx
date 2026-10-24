// 合并回主会话（docs/ui/branch-merge.md §5）：代码（压成一个提交 / 只放进工作区、删副本）和对话（AI 写的摘要，可改）各自能取消
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileText, Sparkles } from 'lucide-react'
import { getLocale, tr, translateMessage } from '@/i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { cn, DiffStat, useToast } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { bridge } from '@/features/engine'
import { paneActions } from '@/features/panes/store'
import type { BranchFile, BranchStatus, BranchSummaryResult } from '../../../../../shared/types/branch'
import { closeBranchDialog, parentIsBranch, sessionRecord } from './store'

const INPUT =
  'w-full min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg outline-none focus:border-accent-line focus:ring-2 focus:ring-composer-ring disabled:opacity-50'

function Check({
  checked,
  disabled,
  onChange,
  label,
  data,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
  data: string
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      data-merge-check={data}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
      className="shrink-0"
    />
  )
}

function FileRow({ file }: { file: BranchFile }) {
  const k = file.path.lastIndexOf('/')
  const tag =
    file.merge === 'conflict'
      ? { text: tr('merge.conflictTag'), cls: 'bg-danger/10 text-danger' }
      : file.merge === 'auto'
        ? { text: tr('merge.auto'), cls: 'bg-accent-soft text-accent-fg' }
        : file.status === 'added'
          ? { text: tr('merge.newFile'), cls: 'bg-subtle text-fg-muted' }
          : file.status === 'deleted'
            ? { text: tr('merge.deletedFile'), cls: 'bg-subtle text-fg-muted' }
            : null
  return (
    <div
      data-merge-file={file.path}
      className="flex h-7 items-center gap-2 text-meta"
      title={file.reason ? tr(`merge.reason.${file.reason}`) : file.path}
    >
      <FileText size={13} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate text-fg-secondary">
        {file.path.slice(0, k + 1)}
        <span className="font-medium text-fg">{file.path.slice(k + 1)}</span>
      </span>
      {tag && <span className={cn('shrink-0 rounded px-1.5 text-label', tag.cls)}>{tag.text}</span>}
      {file.additions !== null && <DiffStat added={file.additions} removed={file.deletions ?? 0} />}
    </div>
  )
}

export function MergeDialog({ sessionId }: { sessionId: string }) {
  useI18n()
  const toast = useToast()
  const record = sessionRecord(sessionId)
  const [status, setStatus] = useState<BranchStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState(true)
  const [strategy, setStrategy] = useState<'commit' | 'apply'>('commit')
  const [message, setMessage] = useState(record?.title ?? '')
  const [removeCopy, setRemoveCopy] = useState(true)
  const [chat, setChat] = useState(true)
  const [summary, setSummary] = useState<string | null>(null)
  const [draft, setDraft] = useState<BranchSummaryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useRef(0)

  useEffect(() => {
    let live = true
    void bridge
      ?.branchStatus(sessionId)
      .then(next => {
        if (!live) return
        setStatus(next)
        setStrategy(next.canCommit ? 'commit' : 'apply')
        if (next.conflicts > 0) setCode(false)
      })
      .catch(e => live && setError(translateMessage((e as Error).message)))
    return () => {
      live = false
    }
  }, [sessionId])

  const write = useCallback(() => {
    const id = ++run.current
    setSummary(null)
    setDraft(null)
    void bridge
      ?.branchSummary(sessionId, getLocale() === 'en-US' ? 'en' : 'zh')
      .then(result => {
        if (run.current !== id) return
        setSummary(result.text)
        setDraft(result)
      })
      .catch(e => {
        if (run.current !== id) return
        setSummary('')
        setDraft({ text: '', ai: false, problem: (e as Error).message })
      })
  }, [sessionId])
  useEffect(write, [write])

  const parentTitle = status?.parentTitle ?? record?.forkedFrom?.title ?? ''
  const up = tr(parentIsBranch(record) ? 'branch.up.parent' : 'branch.up.main')
  const files = status?.files ?? []
  const copyMode = status?.mode === 'copy'
  const hasCode = copyMode && files.length > 0 && !!status?.copyExists
  const codeOn = hasCode && code && (status?.conflicts ?? 0) === 0
  // 副本在但算不出改动（找不到上级的仓库）：代码不能合并，也不能删副本
  const codeUnknown = copyMode && !!status?.codeUnknown
  // 代码没合并时不能删副本（改动还在里面）
  const removeLocked = codeUnknown || (copyMode && files.length > 0 && !codeOn)
  const removeOn = copyMode && !!status?.copyExists && removeCopy && !removeLocked
  const chatOn = chat && summary !== null
  const running = status?.running
  const canSubmit =
    !!status &&
    !busy &&
    !running &&
    (codeOn || chat) &&
    !(chat && summary === null) &&
    !(chat && !summary?.trim() && !codeOn)

  const submit = async (): Promise<void> => {
    if (!bridge || !status) return
    setBusy(true)
    setError(null)
    try {
      const result = await bridge.branchMerge(sessionId, {
        code: codeOn ? { commit: strategy === 'commit' && status.canCommit, message: message.trim() } : null,
        removeCopy: removeOn,
        summary: chatOn && summary?.trim() ? summary.trim() : null,
      })
      closeBranchDialog()
      paneActions.open(status.parentId)
      if (result.commitError) toast(tr('merge.commitFailed', { title: parentTitle, error: result.commitError }))
      else if (result.removeError) toast(tr('merge.removeFailed', { error: result.removeError }))
      else toast(tr(removeOn ? 'merge.doneRemoved' : 'merge.done', { title: parentTitle }))
    } catch (e) {
      setError(translateMessage((e as Error).message) || String(e))
      setBusy(false)
    }
  }

  const confirmLabel = busy
    ? tr('merge.merging')
    : (!hasCode && !codeUnknown) || (codeOn && chat)
      ? tr('merge.submit')
      : codeOn
        ? tr('merge.submitCode')
        : tr('merge.submitChat')

  return (
    <ConfirmDialog
      wide
      title={tr(
        record ? (parentIsBranch(record) ? 'branch.banner.mergeParent' : 'branch.banner.mergeMain') : 'merge.submit',
      )}
      busy={busy}
      error={error ?? (running ? tr(running === 'self' ? 'merge.runningSelf' : 'merge.runningParent') : null)}
      confirmDisabled={!canSubmit}
      confirmLabel={confirmLabel}
      cancelLabel={tr('branch.dialog.cancel')}
      onConfirm={() => void submit()}
      onCancel={closeBranchDialog}
      description={
        <div data-merge-dialog className="flex flex-col gap-3 text-fg">
          <p className="text-meta text-fg-muted">
            {tr('merge.intro', { branch: record?.title ?? '', title: parentTitle })}
          </p>

          {/* 代码 */}
          <section className="overflow-hidden rounded-lg border border-line bg-surface" data-merge-code>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              {hasCode && (
                <Check
                  data="code"
                  label={tr('merge.code')}
                  checked={codeOn}
                  disabled={busy || (status?.conflicts ?? 0) > 0}
                  onChange={setCode}
                />
              )}
              <span className="text-ui font-semibold">{tr('merge.code')}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-fg-muted">
                {!status
                  ? tr('merge.loading')
                  : !copyMode
                    ? tr('merge.codeShared', { title: parentTitle })
                    : !status.copyExists
                      ? tr('merge.copyGone')
                      : codeUnknown
                        ? tr('merge.codeUnknown', { title: parentTitle })
                        : files.length
                          ? tr('merge.codeMeta', {
                              from: status.gitBranch ?? '',
                              to: status.parentBranch ?? parentTitle,
                              n: files.length,
                            })
                          : tr('merge.codeNone')}
              </span>
              {hasCode && (
                <div
                  role="radiogroup"
                  aria-label={tr('merge.code')}
                  className={cn(
                    'inline-flex shrink-0 rounded-lg bg-subtle p-0.5',
                    !codeOn && 'pointer-events-none opacity-50',
                  )}
                >
                  {(['commit', 'apply'] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={strategy === v}
                      data-merge-strategy={v}
                      disabled={busy || (v === 'commit' && !status?.canCommit)}
                      title={
                        v === 'commit' && !status?.canCommit && status?.dirtyThere.length
                          ? tr('merge.commitBlocked', { files: status.dirtyThere.join(', ') })
                          : undefined
                      }
                      onClick={() => setStrategy(v)}
                      className={cn(
                        'press h-6 rounded-md border px-2.5 text-meta disabled:opacity-40',
                        strategy === v
                          ? 'border-line bg-surface font-medium text-fg shadow-sm'
                          : 'border-transparent text-fg-muted hover:text-fg',
                      )}
                    >
                      {tr(v === 'commit' ? 'merge.commit' : 'merge.apply')}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {copyMode && status?.copyExists && (
              <div className="flex flex-col gap-2 border-t border-line-subtle px-3 py-2.5">
                {files.length > 0 && (
                  <div className={cn('flex max-h-48 flex-col overflow-y-auto', !codeOn && 'opacity-50')}>
                    {files.map(f => (
                      <FileRow key={f.path} file={f} />
                    ))}
                  </div>
                )}
                {hasCode && codeOn && strategy === 'commit' && (
                  <label className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 focus-within:border-accent-line">
                    <span className="shrink-0 text-meta text-fg-faint">{tr('merge.commitMsg')}</span>
                    <input
                      data-merge-message
                      value={message}
                      disabled={busy}
                      onChange={e => setMessage(e.target.value)}
                      className="min-w-0 flex-1 bg-transparent py-2 text-ui text-fg outline-none"
                    />
                  </label>
                )}
                {hasCode && codeOn && strategy === 'apply' && (
                  <p className="text-meta text-fg-muted">
                    {tr('merge.applyHint', { title: parentTitle })}
                    {!status.canCommit && status.dirtyThere.length > 0 && (
                      <> {tr('merge.commitBlocked', { files: status.dirtyThere.join(', ') })}</>
                    )}
                  </p>
                )}
                {status.conflicts > 0 && (
                  <div
                    className="flex gap-2 rounded-md bg-warn/10 px-3 py-2 text-meta text-warn-fg"
                    data-merge-conflicts
                  >
                    <AlertTriangle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                    <span>
                      {tr('merge.conflicts', { n: status.conflicts, title: parentTitle })}
                      <span className="mt-1 block">
                        {files
                          .filter(f => f.merge === 'conflict')
                          .map(f => `${f.path} (${tr(`merge.reason.${f.reason ?? 'conflict'}`)})`)
                          .join(', ')}
                      </span>
                    </span>
                  </div>
                )}
                <label
                  className={cn('flex items-center gap-2 text-meta text-fg-secondary', removeLocked && 'opacity-50')}
                >
                  <Check
                    data="remove"
                    label={tr('merge.removeCopy')}
                    checked={removeOn}
                    disabled={busy || removeLocked}
                    onChange={setRemoveCopy}
                  />
                  {tr('merge.removeCopy')}
                  {status.gitBranch && <span className="font-mono text-fg-faint">{status.gitBranch}</span>}
                </label>
                {codeUnknown ? (
                  <p className="text-meta text-fg-muted" data-merge-code-unknown>
                    {tr('merge.codeUnknownKeep')}
                  </p>
                ) : (
                  removeLocked &&
                  status.conflicts === 0 && <p className="text-meta text-fg-muted">{tr('merge.keepCopy')}</p>
                )}
              </div>
            )}
          </section>

          {/* 对话 */}
          <section className="overflow-hidden rounded-lg border border-line bg-surface" data-merge-chat>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <Check data="chat" label={tr('merge.chat')} checked={chat} disabled={busy} onChange={setChat} />
              <span className="text-ui font-semibold">{tr('merge.chat')}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-fg-muted">
                {tr('merge.chatMeta', { title: parentTitle })}
              </span>
              <button
                type="button"
                data-merge-regen
                disabled={busy || !chat || summary === null}
                onClick={write}
                className="press inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                <Sparkles size={13} strokeWidth={1.75} />
                {tr('merge.regen')}
              </button>
            </div>
            <div className={cn('flex flex-col gap-1.5 border-t border-line-subtle px-3 py-2.5', !chat && 'opacity-50')}>
              {summary === null ? (
                <div className="flex flex-col gap-2 py-1" data-merge-writing>
                  {[100, 92, 70, 85].map(w => (
                    <span key={w} className="h-2.5 animate-pulse rounded bg-selected" style={{ width: `${w}%` }} />
                  ))}
                  <span className="text-meta text-fg-muted">{tr('merge.writing')}</span>
                </div>
              ) : (
                <>
                  {draft && !draft.ai && draft.problem !== 'empty' && (
                    <p className="text-meta text-warn" title={draft.problem}>
                      {tr('merge.draftNote')}
                    </p>
                  )}
                  <textarea
                    data-merge-summary
                    value={summary}
                    rows={7}
                    disabled={busy || !chat}
                    onChange={e => setSummary(e.target.value)}
                    className={cn(INPUT, 'resize-y bg-app text-meta leading-relaxed')}
                  />
                  <p className="text-meta text-fg-muted">{tr('merge.summaryNote', { up })}</p>
                </>
              )}
            </div>
          </section>
        </div>
      }
    />
  )
}
