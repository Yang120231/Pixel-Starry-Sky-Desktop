import { useI18n } from '@/i18n/I18nProvider'
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
import type { AlwaysScope, ApprovalDecision, ApprovalRequest } from '@pixelsky/protocol'
import { Button, DiffStat, Popover, cn } from '@/components/ui'
import { DiffView } from './ItemRows'
import { Markdown } from './Markdown'

const ICON: Record<ApprovalRequest['kind'], LucideIcon> = {
  command: SquareTerminal,
  file_change: FilePen,
  tool: Wrench,
  question: MessageCircleQuestion,
  plan: ListChecks,
}

const BODY = 'max-h-[34vh] overflow-auto'

/** 「始终允许」的范围（docs/engines.md §15.6） */
const SCOPE_INFO: Record<AlwaysScope, { label: string; desc: string }> = {
  session: {
    get label() {
      return tr('session.live.ApprovalCard.message221')
    },
    get desc() {
      return tr('session.live.ApprovalCard.message222')
    },
  },
  project: {
    get label() {
      return tr('session.live.ApprovalCard.message223')
    },
    get desc() {
      return tr('session.live.ApprovalCard.message224')
    },
  },
  user: {
    get label() {
      return tr('session.live.ApprovalCard.message225')
    },
    get desc() {
      return tr('session.live.ApprovalCard.message226')
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
        {tr('session.live.ApprovalCard.message227')}{' '}
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
        {tr('session.live.ApprovalCard.message228')}{' '}
        <ChevronDown size={14} strokeWidth={1.5} className="text-fg-muted" />
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} className="bottom-full left-0 mb-2 w-72">
        <div className="px-2 pt-1.5 pb-1 text-label font-medium text-fg-faint">
          {tr('session.live.ApprovalCard.message229')}
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

export function ApprovalCard({
  request,
  onAnswer,
}: {
  request: ApprovalRequest
  onAnswer: (d: ApprovalDecision) => void
}) {
  useI18n()
  const Icon = ICON[request.kind]
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [sent, setSent] = useState(false)
  const [formText, setFormText] = useState('{}')
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
    onAnswer(d)
  }

  const toggle = (question: string, label: string, multi: boolean): void => {
    setAnswers(prev => {
      const cur = prev[question] ?? []
      const next = multi ? (cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label]) : [label]
      return { ...prev, [question]: next }
    })
  }

  const questions = request.questions ?? []
  const allAnswered = questions.every(q => (answers[q.question]?.length ?? 0) > 0)

  return (
    <section className="pop-in mb-3 rounded-xl border border-line-strong bg-surface shadow-menu" aria-live="polite">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-ui font-medium text-fg">
        <Icon size={16} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1 truncate">{translateMessage(request.title)}</span>
        <span className="shrink-0 text-meta font-normal text-fg-faint">
          {tr('session.live.ApprovalCard.message230')}
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
        {request.kind === 'command' && (
          <>
            {request.description && <p className="mb-1.5 text-list text-fg-muted">{request.description}</p>}
            <pre
              className={cn(
                BODY,
                'rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-[length:calc(12.5px*var(--font-scale,1))] leading-[1.6] whitespace-pre-wrap text-fg',
              )}
            >
              {request.command}
            </pre>
          </>
        )}

        {request.kind === 'file_change' && (
          <div className={cn(BODY, 'rounded-lg border border-line')}>
            {(request.changes ?? []).map(c => (
              <div key={c.path} className="border-b border-line-subtle last:border-b-0">
                <div className="flex items-center gap-2 px-3 py-1.5 text-list">
                  <span className="min-w-0 flex-1 truncate font-mono text-[length:calc(12.5px*var(--font-scale,1))] text-code-path">
                    {c.path}
                  </span>
                  <DiffStat added={c.added} removed={c.removed} className="text-meta" />
                </div>
                <DiffView diff={c.diff} path={c.path} className="pb-1.5" />
              </div>
            ))}
          </div>
        )}

        {request.kind === 'tool' && (
          <>
            {request.description && <p className="mb-1.5 truncate text-list text-fg-muted">{request.description}</p>}
            <pre
              className={cn(
                BODY,
                'rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-meta leading-[1.6] whitespace-pre-wrap text-fg-secondary',
              )}
            >
              {JSON.stringify(request.input, null, 2)}
            </pre>
          </>
        )}

        {request.kind === 'plan' && (
          <div className={cn(BODY, 'rounded-lg border border-line bg-wall-tint px-4 py-3')}>
            <Markdown text={request.plan || tr('session.live.ApprovalCard.message231')} />
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
                    <span className="ml-1 text-meta text-fg-faint">{tr('session.live.ApprovalCard.message232')}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {(q.options.length === 0 || q.allowOther) && (
                    <input
                      type={q.secret ? 'password' : 'text'}
                      aria-label={q.question}
                      className="rounded-md border border-line bg-subtle px-3 py-2 text-list text-fg"
                      value={answers[q.question]?.[0] ?? ''}
                      onChange={event =>
                        setAnswers(current => ({
                          ...current,
                          [q.question]: event.target.value ? [event.target.value] : [],
                        }))
                      }
                    />
                  )}
                  {q.options.map(o => {
                    const on = answers[q.question]?.includes(o.label) ?? false
                    return (
                      <button
                        key={o.label}
                        type="button"
                        onClick={() => toggle(q.question, o.label, q.multiSelect)}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-left hover:bg-hover',
                          on ? 'border-accent bg-accent-soft hover:bg-accent-soft' : 'border-line',
                        )}
                      >
                        <span className={cn('block text-list', on ? 'text-accent-fg' : 'text-fg')}>{o.label}</span>
                        {o.description && <span className="block text-meta text-fg-muted">{o.description}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 rounded-b-xl border-t border-line-subtle bg-wall-tint px-4 py-2.5">
        {request.kind === 'question' ? (
          <>
            <Button
              variant="primary"
              disabled={!allAnswered || sent}
              className="disabled:opacity-50"
              onClick={() =>
                answer({
                  type: 'answer',
                  answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.join(', ')])),
                })
              }
            >
              {tr('session.live.ApprovalCard.message233')}{' '}
            </Button>
            <Button
              variant="ghost"
              disabled={sent}
              onClick={() =>
                answer({
                  type: 'deny',
                  get message() {
                    return tr('session.live.ApprovalCard.message234')
                  },
                })
              }
            >
              {tr('session.live.ApprovalCard.message235')}{' '}
            </Button>
          </>
        ) : request.kind === 'plan' ? (
          <>
            <Button variant="primary" disabled={sent} onClick={() => answer({ type: 'allow' })}>
              {tr('session.live.ApprovalCard.message236')}{' '}
            </Button>
            <Button variant="ghost" disabled={sent} onClick={() => answer({ type: 'deny' })}>
              {tr('session.live.ApprovalCard.message237')}{' '}
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
              {tr('session.live.ApprovalCard.message238')}{' '}
            </Button>
            {request.alwaysScopes.length > 0 && (
              <AlwaysAllowButton
                scopes={request.alwaysScopes}
                disabled={sent}
                onPick={scope => answer({ type: 'allow_always', scope })}
              />
            )}
            <Button variant="ghost" disabled={sent} onClick={() => answer({ type: 'deny' })}>
              {tr('session.live.ApprovalCard.message239')}{' '}
            </Button>
          </>
        )}
      </footer>
    </section>
  )
}
