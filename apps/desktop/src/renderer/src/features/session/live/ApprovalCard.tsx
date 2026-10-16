import { useI18n } from '@/i18n/I18nProvider'
import {
  EMPTY_DRAFT,
  canWriteIn,
  collectAnswers,
  displayLabel,
  isRecommended,
  pickOption,
  recommendedAnswers,
  toggleOther,
  type QuestionDraft,
} from './questionModel'
import { tr, translateMessage } from '../../../i18n/core'
// 审批卡片：引擎等你决定时固定显示在输入框上方（docs/engines.md §5.5）
import { useState } from 'react'
import {
  ChevronDown,
  FilePen,
  ListChecks,
  MessageCircleQuestion,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { AlwaysScope, ApprovalDecision, ApprovalRequest, Question } from '@pixelsky/protocol'
import { Button, DiffStat, Popover, cn } from '@/ui'
import { DiffView } from '@/ui/code/DiffView'
import { CommandText } from '@/ui/code/CommandText'
import { Markdown } from '@/ui/markdown/Markdown'
import { FullAccessConfirm } from '../FullAccessConfirm'

const ICON: Record<ApprovalRequest['kind'], LucideIcon> = {
  command: SquareTerminal,
  file_change: FilePen,
  tool: Wrench,
  question: MessageCircleQuestion,
  plan: ListChecks,
}

const BODY = 'max-h-[34vh] overflow-auto'

/** 「始终允许」的范围（docs/engines.md §15.6） */
export const SCOPE_INFO: Record<AlwaysScope, { label: string; desc: string }> = {
  session: {
    get label() {
      return tr('session.live.ApprovalCard.thisSession')
    },
    get desc() {
      return tr('session.live.ApprovalCard.expiresWhenThisSession')
    },
  },
  project: {
    get label() {
      return tr('session.live.ApprovalCard.thisProject')
    },
    get desc() {
      return tr('session.live.ApprovalCard.saveToProjectsClaude')
    },
  },
  user: {
    get label() {
      return tr('session.live.ApprovalCard.allProjects')
    },
    get desc() {
      return tr('session.live.ApprovalCard.saveToClaudeSettings')
    },
  },
}

/** 「始终允许…」：只有一个范围时直接是按钮，多个时弹出范围菜单 */
function AlwaysAllowButton({
  scopes,
  disabled,
  onPick,
}: {
  scopes: AlwaysScope[]
  disabled: boolean
  onPick: (s: AlwaysScope) => void
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  if (scopes.length === 1) {
    return (
      <Button variant="outline" disabled={disabled} onClick={() => onPick(scopes[0])}>
        {SCOPE_INFO[scopes[0]].label}
        {tr('session.live.ApprovalCard.alwaysAllow')}{' '}
      </Button>
    )
  }
  return (
    <span className="relative">
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {tr('session.live.ApprovalCard.alwaysAllow2')}{' '}
        <ChevronDown size={14} strokeWidth={1.5} className="text-fg-muted" />
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} side="top" offset={8} className="w-72">
        <div className="px-2 pt-1.5 pb-1 text-label font-medium text-fg-faint">
          {tr('session.live.ApprovalCard.alwaysAllowScope')}
        </div>
        {scopes.map(scope => (
          <button
            key={scope}
            type="button"
            onClick={() => {
              setOpen(false)
              onPick(scope)
            }}
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-hover"
          >
            <span className="text-ui text-fg">{SCOPE_INFO[scope].label}</span>
            <span className="text-meta text-fg-muted">{SCOPE_INFO[scope].desc}</span>
          </button>
        ))}
      </Popover>
    </span>
  )
}

/** 命令、改文件、工具的内容区（单张卡和合并列表里展开的一行共用） */
export function ApprovalBody({
  request,
  className = BODY,
  compact = false,
}: {
  request: ApprovalRequest
  className?: string
  /** 合并列表里展开的一行：工具的说明（服务 · 工具）行上已经写了，不再重复 */
  compact?: boolean
}) {
  if (request.kind === 'command')
    return (
      <>
        {request.description && <p className="mb-1.5 text-list text-fg-muted">{request.description}</p>}
        <pre
          className={cn(
            className,
            'rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-[length:calc(12.5px*var(--font-scale,1))] leading-[1.6] whitespace-pre-wrap text-fg',
          )}
        >
          <CommandText command={request.command ?? ''} />
        </pre>
      </>
    )
  if (request.kind === 'file_change')
    return (
      <div className={cn(className, 'rounded-lg border border-line')}>
        {(request.changes ?? []).map(c => (
          <div key={c.path} className="border-b border-line-subtle last:border-b-0">
            <div className="flex items-center gap-2 px-3 py-1.5 text-list">
              <span className="min-w-0 flex-1 truncate font-mono text-[length:calc(12.5px*var(--font-scale,1))] text-code-path">
                {c.path}
              </span>
              <DiffStat added={c.added} removed={c.removed} className="text-meta" />
            </div>
            <DiffView diff={c.diff} path={c.path} className="pb-1.5" commentable={false} />
          </div>
        ))}
      </div>
    )
  if (request.kind === 'tool')
    return (
      <>
        {request.description && !compact && (
          <p className="mb-1.5 truncate text-list text-fg-muted">{request.description}</p>
        )}
        <pre
          className={cn(
            className,
            'rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-meta leading-[1.6] whitespace-pre-wrap text-fg-secondary',
          )}
        >
          {JSON.stringify(request.input, null, 2)}
        </pre>
      </>
    )
  return null
}

export function ApprovalCard({
  request,
  onAnswer,
}: {
  request: ApprovalRequest
  /** 返回 Promise 时等它结果：失败了卡片恢复可点并显示原因，不会卡住 */
  onAnswer: (d: ApprovalDecision) => void | Promise<unknown>
}) {
  useI18n()
  const Icon = ICON[request.kind]
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({})
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [formText, setFormText] = useState('{}')
  // 「本会话后续不再询问」会切成完全放行：先在卡片底部就地确认，AI 继续等
  const [confirmingAll, setConfirmingAll] = useState(false)
  let formContent: Record<string, unknown> | null = null
  try {
    const value: unknown = JSON.parse(formText)
    if (value && typeof value === 'object' && !Array.isArray(value)) formContent = value as Record<string, unknown>
  } catch {
    /* 等待用户填好 */
  }

  const answer = (d: ApprovalDecision): void => {
    if (sent) return
    setSent(true)
    setFailure(null)
    void Promise.resolve()
      .then(() => onAnswer(d))
      .catch((e: unknown) => {
        setSent(false)
        setFailure(e instanceof Error ? e.message : String(e))
      })
  }

  const questions = request.questions ?? []
  const draft = (q: Question): QuestionDraft => drafts[q.question] ?? EMPTY_DRAFT
  const update = (q: Question, next: (d: QuestionDraft) => QuestionDraft): void =>
    setDrafts(prev => ({ ...prev, [q.question]: next(prev[q.question] ?? EMPTY_DRAFT) }))
  const answers = collectAnswers(questions, drafts)
  const recommended = request.kind === 'question' ? recommendedAnswers(questions) : null

  return (
    <section
      className="pop-in shrink-0 rounded-xl border border-line-strong bg-surface shadow-menu"
      aria-live="polite"
      data-approval-card
      data-approval-request={request.requestId}
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-ui font-medium text-fg">
        <Icon size={16} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1 truncate">{translateMessage(request.title)}</span>
        <span className="shrink-0 text-meta font-normal text-fg-faint">
          {tr('session.live.ApprovalCard.waitingForYourDecision')}
        </span>
      </header>

      <div className="px-4 pb-3">
        {request.formSchema !== undefined && (
          <label className="mb-3 flex flex-col gap-2 text-meta text-fg-muted">
            {tr('codex.mcpInput')}
            <textarea
              className="min-h-24 rounded-md border border-line bg-subtle p-2 font-mono text-meta text-fg"
              value={formText}
              onChange={event => setFormText(event.target.value)}
            />
          </label>
        )}
        <ApprovalBody request={request} />

        {request.kind === 'plan' && (
          <div className={cn(BODY, 'rounded-lg border border-line bg-wall-tint px-4 py-3')}>
            <Markdown text={request.plan || tr('session.live.ApprovalCard.noPlanContent')} />
          </div>
        )}

        {request.kind === 'question' && (
          <div className={cn(BODY, 'flex flex-col gap-3')}>
            {questions.map(q => (
              <div key={q.question}>
                <div className="mb-1.5 text-list text-fg">
                  {q.header && (
                    <span className="mr-1.5 rounded-sm bg-subtle px-1.5 py-0.5 text-label text-fg-muted">
                      {q.header}
                    </span>
                  )}
                  {q.question}
                  {q.multiSelect && (
                    <span className="ml-1 text-meta text-fg-faint">
                      {tr('session.live.ApprovalCard.selectMultiple')}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {q.options.map(o => {
                    const on = draft(q).picks.includes(o.label)
                    return (
                      <button
                        key={o.label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update(q, d => pickOption(q, d, o.label))}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left hover:bg-hover',
                          on ? 'border-accent bg-accent-soft hover:bg-accent-soft' : 'border-line',
                        )}
                      >
                        <span className={cn('flex items-center gap-1.5 text-list', on ? 'text-accent-fg' : 'text-fg')}>
                          {displayLabel(o.label)}
                          {isRecommended(o.label) && (
                            <span
                              data-recommended
                              className="rounded-sm bg-accent-soft px-1.5 py-px text-label text-accent-fg"
                            >
                              {tr('question.recommended')}
                            </span>
                          )}
                        </span>
                        {o.description && <span className="block text-meta text-fg-muted">{o.description}</span>}
                      </button>
                    )
                  })}
                  {canWriteIn(q) && q.options.length > 0 && (
                    <button
                      type="button"
                      aria-pressed={draft(q).other}
                      data-question-other
                      onClick={() => update(q, d => toggleOther(q, d))}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left text-list hover:bg-hover',
                        draft(q).other
                          ? 'border-accent bg-accent-soft text-accent-fg hover:bg-accent-soft'
                          : 'border-line text-fg',
                      )}
                    >
                      {tr('question.other')}
                    </button>
                  )}
                  {canWriteIn(q) && (q.options.length === 0 || draft(q).other) && (
                    <input
                      type={q.secret ? 'password' : 'text'}
                      aria-label={q.question}
                      placeholder={tr('question.otherPlaceholder')}
                      autoFocus={q.options.length > 0}
                      className="rounded-md border border-line bg-subtle px-3 py-2 text-list text-fg placeholder:text-fg-faint"
                      value={draft(q).text}
                      onChange={event => {
                        const text = event.target.value
                        update(q, d => ({ ...d, text }))
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing && answers && !sent) {
                          event.preventDefault()
                          answer({ type: 'answer', answers })
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {failure && (
        <p role="alert" className="px-4 pb-2 text-meta text-danger">
          {tr('session.live.ApprovalCard.sendFailed', { p0: translateMessage(failure) })}
        </p>
      )}
      {confirmingAll ? (
        <FullAccessConfirm
          title={tr('fullAccess.confirm.title')}
          items={[tr('fullAccess.confirm.allowThis'), tr('fullAccess.confirm.scopeCard')]}
          cancelLabel={tr('fullAccess.confirm.back')}
          confirmLabel={tr('fullAccess.confirm.allowThisOk')}
          disabled={sent}
          onCancel={() => setConfirmingAll(false)}
          onConfirm={() => answer({ type: 'allow_all' })}
          className="rounded-b-xl border-t border-line-subtle bg-hover px-4 pt-2.5 pb-2.5"
        />
      ) : (
        <footer className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-line-subtle bg-wall-tint px-4 py-2.5">
          {request.kind === 'question' ? (
            <>
              <Button
                variant="primary"
                disabled={!answers || sent}
                className="disabled:opacity-50"
                onClick={() => answers && answer({ type: 'answer', answers })}
              >
                {tr('session.live.ApprovalCard.submitAnswers')}{' '}
              </Button>
              {recommended && (
                <Button
                  variant="outline"
                  disabled={sent}
                  data-all-recommended
                  onClick={() => answer({ type: 'answer', answers: recommended })}
                >
                  {tr('question.allRecommended')}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={sent}
                onClick={() =>
                  answer({
                    type: 'deny',
                    get message() {
                      return tr('session.live.ApprovalCard.userSkippedThisQuestion')
                    },
                  })
                }
              >
                {tr('session.live.ApprovalCard.skip')}{' '}
              </Button>
            </>
          ) : request.kind === 'plan' ? (
            <>
              <Button variant="primary" disabled={sent} onClick={() => answer({ type: 'allow' })}>
                {tr('session.live.ApprovalCard.startExecution')}{' '}
              </Button>
              <Button variant="ghost" disabled={sent} onClick={() => answer({ type: 'deny' })}>
                {tr('session.live.ApprovalCard.refinePlan')}{' '}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={sent || request.canAllow === false || (request.formSchema !== undefined && !formContent)}
                onClick={() =>
                  answer(request.formSchema !== undefined ? { type: 'form', content: formContent! } : { type: 'allow' })
                }
              >
                {tr('session.live.ApprovalCard.allowOnce')}{' '}
              </Button>
              {request.alwaysScopes.length > 0 && (
                <AlwaysAllowButton
                  scopes={request.alwaysScopes}
                  disabled={sent}
                  onPick={scope => answer({ type: 'allow_always', scope })}
                />
              )}
              <Button variant="ghost" disabled={sent} onClick={() => answer({ type: 'deny' })}>
                {tr('session.live.ApprovalCard.deny')}{' '}
              </Button>
              {request.canAllowAll && (
                <Button
                  variant="outline"
                  className="ml-auto"
                  disabled={sent}
                  title={tr('session.live.ApprovalCard.allowAllHint')}
                  onClick={() => setConfirmingAll(true)}
                >
                  {tr('session.live.ApprovalCard.allowAll')}
                </Button>
              )}
            </>
          )}
        </footer>
      )}
    </section>
  )
}
