// 审批 / 提问卡片：从底部升起的面板，大按钮（docs/mobile-remote.md §8.3）。
// 「总是允许」在手机上多问一次（§10 第 6 问按推荐）。
import { useState } from 'react'
import { CircleHelp, ClipboardList, FilePen, ShieldAlert, SquareTerminal, Wrench } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@pixelsky/protocol'
import { Button, DiffView, cn } from '@/ui'
import { MarkdownText } from '@/ui/Markdown'

const ICONS = {
  command: SquareTerminal,
  file_change: FilePen,
  tool: Wrench,
  question: CircleHelp,
  plan: ClipboardList,
} as const

const SCOPE_TEXT = { session: '这个任务里', project: '这个项目里', user: '所有项目里' } as const

export function ApprovalCard({
  request,
  canAct,
  onAnswer,
}: {
  request: ApprovalRequest
  canAct: boolean
  onAnswer(decision: ApprovalDecision): Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [confirmAlways, setConfirmAlways] = useState(false)
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const answer = async (d: ApprovalDecision) => {
    setBusy(true)
    try {
      await onAnswer(d)
    } finally {
      setBusy(false)
    }
  }
  const questions = request.questions ?? []
  const scope = request.alwaysScopes[0]
  const Icon = ICONS[request.kind] ?? ShieldAlert

  return (
    <div className="sheet-in flex max-h-[70dvh] flex-col rounded-t-3xl border-t border-line bg-surface shadow-popover">
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-notify">
            <Icon size={19} />
          </span>
          <div className="min-w-0">
            <div className="text-section font-semibold">{request.title}</div>
            <div className="text-meta text-fg-muted">
              {request.kind === 'question' ? '需要你回答' : '需要你允许才能继续'}
            </div>
          </div>
        </div>
        {request.description && <p className="text-meta text-fg-secondary">{request.description}</p>}
        {request.command && (
          <pre className="max-h-40 overflow-auto rounded-xl bg-subtle px-3 py-2.5 font-mono text-label break-all whitespace-pre-wrap">
            {request.command}
          </pre>
        )}
        {request.changes?.map(c => (
          <div key={c.path} className="overflow-hidden rounded-xl border border-line-subtle">
            <p className="truncate bg-subtle px-3 py-1.5 font-mono text-label text-fg-muted">{c.path}</p>
            <div className="max-h-48 overflow-auto">
              <DiffView diff={c.diff} />
            </div>
          </div>
        ))}
        {request.plan && (
          <div className="max-h-64 overflow-auto rounded-xl bg-subtle px-3.5 py-2.5">
            <MarkdownText text={request.plan} />
          </div>
        )}

        {request.kind === 'question' ? (
          <>
            {questions.map(q => (
              <fieldset key={q.question} className="flex flex-col gap-2">
                <legend className="pb-1 text-ui font-medium">{q.question}</legend>
                {q.multiSelect && <span className="-mt-1 text-label text-fg-muted">可以多选</span>}
                {q.options.map(o => {
                  const on = picked[q.question]?.includes(o.label) ?? false
                  return (
                    <button
                      key={o.label}
                      type="button"
                      disabled={!canAct}
                      onClick={() =>
                        setPicked(p => {
                          const cur = p[q.question] ?? []
                          const next = q.multiSelect
                            ? on
                              ? cur.filter(x => x !== o.label)
                              : [...cur, o.label]
                            : [o.label]
                          return { ...p, [q.question]: next }
                        })
                      }
                      className={cn(
                        'flex min-h-12 items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                        on ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-4.5 shrink-0 items-center justify-center border-2',
                          q.multiSelect ? 'rounded-md' : 'rounded-full',
                          on ? 'border-accent bg-accent' : 'border-line-strong',
                        )}
                      >
                        {on && (
                          <span
                            className={cn('size-1.5 bg-accent-on', q.multiSelect ? 'rounded-sm' : 'rounded-full')}
                          />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-ui">{o.label}</span>
                        {o.description && <span className="block text-meta text-fg-muted">{o.description}</span>}
                      </span>
                    </button>
                  )
                })}
              </fieldset>
            ))}
            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!canAct || busy}
                onClick={() => void answer({ type: 'deny' })}
              >
                不回答
              </Button>
              <Button
                variant="primary"
                className="flex-[2]"
                disabled={!canAct || busy || questions.some(q => !picked[q.question]?.length)}
                onClick={() =>
                  void answer({
                    type: 'answer',
                    answers: Object.fromEntries(
                      questions.map(q => [q.question, (picked[q.question] ?? []).join(', ')]),
                    ),
                  })
                }
              >
                提交回答
              </Button>
            </div>
          </>
        ) : confirmAlways && scope ? (
          <div className="flex flex-col gap-2 rounded-xl bg-subtle p-3">
            <p className="text-ui">{SCOPE_TEXT[scope] ?? ''}以后同类操作都不再问？</p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => setConfirmAlways(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={busy}
                onClick={() => void answer({ type: 'allow_always', scope })}
              >
                总是允许
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex gap-2">
              {request.canDeny !== false && (
                <Button
                  variant="danger"
                  className="flex-1"
                  disabled={!canAct || busy}
                  onClick={() => void answer({ type: 'deny' })}
                >
                  拒绝
                </Button>
              )}
              {request.canAllow !== false && (
                <Button
                  variant="primary"
                  className="flex-[2]"
                  disabled={!canAct || busy}
                  onClick={() => void answer({ type: 'allow' })}
                >
                  允许
                </Button>
              )}
            </div>
            {scope && (
              <Button variant="ghost" size="sm" disabled={!canAct || busy} onClick={() => setConfirmAlways(true)}>
                总是允许…
              </Button>
            )}
          </div>
        )}
        {!canAct && <p className="text-center text-meta text-fg-muted">这部手机是「只看」，要在电脑上处理。</p>}
      </div>
    </div>
  )
}
