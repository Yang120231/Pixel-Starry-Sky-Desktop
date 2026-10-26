// 审批 / 提问卡片：顶替输入框位置的浮动圆角卡片，大圆按钮（docs/mobile-remote.md §8.3、§26）；
// 逐个处理时「1 / 3」小圆点和「跳过」放在卡片顶上一行的右边（triage）。
// 「总是允许」在手机上多问一次（§10 第 6 问按推荐）。提问：推荐项、「都按推荐」、自己填答案、密码类的题
// 用密码框（§17 第 3 项，规则同桌面）；要填表单的请求手机上只能拒绝或回电脑处理。
// 有键盘时 Ctrl / ⌘+Enter 允许、Ctrl / ⌘+Backspace 拒绝（§25；只在普通的允许 / 拒绝时，提问和「总是允许」确认不算）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleHelp, ClipboardList, FilePen, ShieldAlert, Sparkles, SquareTerminal, Wrench } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest, Question } from '@pixelsky/protocol'
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
} from '@/data/questions'
import { toolError } from '@/data/tools'
import { L } from '@/i18n'
import { isEditable } from '@/platform/keys'
import { Button, DiffView, cn } from '@/ui'
import { MarkdownText } from '@/ui/Markdown'

const ICONS = {
  command: SquareTerminal,
  file_change: FilePen,
  tool: Wrench,
  question: CircleHelp,
  plan: ClipboardList,
} as const

/** 「总是允许」的确认问句：按范围说 */
function alwaysQuestion(scope: string): string {
  switch (scope) {
    case 'session':
      return L('这个任务里以后同类操作都不再问？', 'Stop asking about this kind of action in this task?')
    case 'project':
      return L('这个项目里以后同类操作都不再问？', 'Stop asking about this kind of action in this project?')
    case 'user':
      return L('所有项目里以后同类操作都不再问？', 'Stop asking about this kind of action in all projects?')
    default:
      return L('以后同类操作都不再问？', 'Stop asking about this kind of action?')
  }
}

/** 逐个处理的进度：小圆点（最多 10 个）+ 「2 / 5」；会话页没有待审批时的那条细条也用 */
export function TriageProgress({ index, total }: { index: number; total: number }) {
  return (
    <>
      {total <= 10 && (
        <span className="flex shrink-0 gap-1" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <i
              key={i}
              className={cn(
                'size-1.5 rounded-full',
                i < index - 1 ? 'bg-online' : i === index - 1 ? 'bg-notify' : 'bg-line-strong',
              )}
            />
          ))}
        </span>
      )}
      <span className="shrink-0">
        {index} / {total}
      </span>
    </>
  )
}

export function ApprovalCard({
  request,
  canAct,
  onAnswer,
  more = 0,
  triage,
}: {
  request: ApprovalRequest
  canAct: boolean
  onAnswer(decision: ApprovalDecision): Promise<void>
  /** 同时还有几项在等（AI 一次并行调用几个要审批的工具）：一项一项处理，这里写还剩几项 */
  more?: number
  /** 逐个处理等你的会话时：第几个、一共几个、跳过 */
  triage?: { index: number; total: number; onNext(): void } | null
}) {
  const [busy, setBusy] = useState(false)
  const [confirmAlways, setConfirmAlways] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({})
  // 没送到电脑（断线、超时、只看）：卡片还在，写明没处理成，可以再点一次
  const [error, setError] = useState<string | null>(null)
  const answer = async (d: ApprovalDecision) => {
    setBusy(true)
    setError(null)
    try {
      await onAnswer(d)
    } catch (e) {
      setError(L(`没有送到电脑：${toolError(e)}`, `Didn't reach the computer: ${toolError(e)}`))
    } finally {
      setBusy(false)
    }
  }
  const questions = useMemo(() => request.questions ?? [], [request.questions])
  const recommended = useMemo(() => recommendedAnswers(questions), [questions])
  const answers = collectAnswers(questions, drafts)
  const form = request.formSchema !== undefined
  const scope = request.alwaysScopes[0]
  // 键盘：只在显示「拒绝 / 允许」两个按钮时
  const plain = request.kind !== 'question' && !form && !confirmAlways
  const keyAnswer = useRef(answer)
  keyAnswer.current = answer
  useEffect(() => {
    if (!plain || !canAct || busy) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing) return
      // 焦点在输入框里（抽屉的搜索框、改名框）：Ctrl+Backspace 是删一个词，不能当成拒绝
      if (isEditable(e.target)) return
      const decision =
        e.key === 'Enter' && request.canAllow !== false
          ? ({ type: 'allow' } as const)
          : e.key === 'Backspace' && request.canDeny !== false
            ? ({ type: 'deny' } as const)
            : null
      if (!decision) return
      e.preventDefault()
      void keyAnswer.current(decision)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plain, canAct, busy, request.canAllow, request.canDeny])
  const Icon = ICONS[request.kind] ?? ShieldAlert

  return (
    <div className="sheet-in mx-3 mb-3 flex max-h-[calc(var(--app-height,100dvh)*0.7)] flex-col rounded-[26px] border border-line bg-surface shadow-popover">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center text-warn">
            <Icon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-prose font-semibold">{request.title}</div>
            <div className="text-meta text-fg-muted">
              {request.kind === 'question'
                ? L('需要你回答', 'Needs your answer')
                : L('需要你允许才能继续', 'Needs your approval to continue')}
              {more > 0 && <span data-approval-more> · {L(`后面还有 ${more} 项`, `${more} more`)}</span>}
            </div>
          </div>
          {triage && (
            <div data-triage className="flex shrink-0 items-center gap-2 self-start text-meta text-fg-muted">
              <TriageProgress index={triage.index} total={triage.total} />
              <button
                type="button"
                onClick={triage.onNext}
                className="-my-2 min-h-11 pl-1 text-ui font-semibold text-accent-fg active:opacity-70"
              >
                {L('跳过', 'Skip')}
              </button>
            </div>
          )}
        </div>
        {request.description && <p className="text-meta text-fg-secondary">{request.description}</p>}
        {request.wrapper && request.wrapper.extra.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-warn/12 px-3 py-2 text-meta text-warn">
            <span>
              {(shell => L(`外层 ${shell} 还带了参数：`, `The outer ${shell} also has arguments:`))(
                request.wrapper.shell === 'powershell' ? 'PowerShell' : request.wrapper.shell,
              )}
            </span>
            {request.wrapper.extra.map((a, i) => (
              <code key={i} className="rounded-sm bg-warn/15 px-1.5 font-mono text-label break-all">
                {a}
              </code>
            ))}
          </p>
        )}
        {request.command && (
          <pre className="max-h-40 overflow-auto rounded-2xl bg-subtle px-3.5 py-3 font-mono text-label [overflow-wrap:anywhere] whitespace-pre-wrap">
            {request.command}
          </pre>
        )}
        {request.changes?.map(c => (
          <div key={c.path} className="overflow-hidden rounded-2xl border border-line-subtle">
            <p className="truncate bg-subtle px-3 py-1.5 font-mono text-label text-fg-muted">{c.path}</p>
            <div className="max-h-48 overflow-auto">
              <DiffView diff={c.diff} />
            </div>
          </div>
        ))}
        {request.plan && (
          <div className="max-h-64 overflow-auto rounded-2xl bg-subtle px-3.5 py-2.5">
            <MarkdownText text={request.plan} />
          </div>
        )}

        {request.kind === 'question' ? (
          <>
            {questions.map(q => (
              <QuestionField
                key={q.question}
                question={q}
                draft={drafts[q.question] ?? EMPTY_DRAFT}
                disabled={!canAct || busy}
                onChange={d => setDrafts(all => ({ ...all, [q.question]: d }))}
              />
            ))}
            <div className="flex flex-col gap-2 pt-1">
              {recommended && (
                <Button
                  variant="secondary"
                  className="rounded-full!"
                  disabled={!canAct || busy}
                  onClick={() => void answer({ type: 'answer', answers: recommended })}
                >
                  <Sparkles size={16} /> {L('都按推荐', 'Use all recommended')}
                </Button>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1 rounded-full!"
                  disabled={!canAct || busy}
                  onClick={() => void answer({ type: 'deny' })}
                >
                  {L('不回答', "Don't answer")}
                </Button>
                <Button
                  variant="primary"
                  className="flex-[2] rounded-full!"
                  disabled={!canAct || busy || !answers}
                  onClick={() => answers && void answer({ type: 'answer', answers })}
                >
                  {L('提交回答', 'Submit answers')}
                </Button>
              </div>
            </div>
          </>
        ) : form ? (
          <div className="flex flex-col gap-2">
            <p className="rounded-2xl bg-subtle px-3.5 py-3 text-meta text-fg-secondary">
              {L(
                '这个请求要填一张表单，手机上还填不了，请到电脑上处理；也可以在这里拒绝。',
                "This request needs a form that can't be filled in on the phone yet. Handle it on the computer, or deny it here.",
              )}
            </p>
            {request.canDeny !== false && (
              <Button
                variant="danger"
                className="rounded-full!"
                disabled={!canAct || busy}
                onClick={() => void answer({ type: 'deny' })}
              >
                {L('拒绝', 'Deny')}
              </Button>
            )}
          </div>
        ) : confirmAlways && scope ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-subtle p-3">
            <p className="text-ui">{alwaysQuestion(scope)}</p>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-full!" onClick={() => setConfirmAlways(false)}>
                {L('取消', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                className="flex-1 rounded-full!"
                disabled={busy}
                onClick={() => void answer({ type: 'allow_always', scope })}
              >
                {L('总是允许', 'Always allow')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              {request.canDeny !== false && (
                <Button
                  variant="secondary"
                  className="flex-1 rounded-full!"
                  disabled={!canAct || busy}
                  onClick={() => void answer({ type: 'deny' })}
                >
                  {L('拒绝', 'Deny')}
                </Button>
              )}
              {request.canAllow !== false && (
                <Button
                  variant="primary"
                  className="flex-1 rounded-full!"
                  disabled={!canAct || busy}
                  onClick={() => void answer({ type: 'allow' })}
                >
                  {L('允许', 'Allow')}
                </Button>
              )}
            </div>
            {scope && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 self-center text-fg-muted!"
                disabled={!canAct || busy}
                onClick={() => setConfirmAlways(true)}
              >
                {L('总是允许…', 'Always allow…')}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-center text-meta text-danger">
            {error}
          </p>
        )}
        {!canAct && (
          <p className="text-center text-meta text-fg-muted">
            {L(
              '这部手机是「只看」，要在电脑上处理。',
              'This phone is set to “View only”. Handle this on the computer.',
            )}
          </p>
        )}
      </div>
    </div>
  )
}

/** 一道题：选项（推荐的带标签）、「其他」自己填；没有选项的题直接填 */
function QuestionField({
  question: q,
  draft,
  disabled,
  onChange,
}: {
  question: Question
  draft: QuestionDraft
  disabled: boolean
  onChange(d: QuestionDraft): void
}) {
  const writeIn = canWriteIn(q)
  const writing = q.options.length === 0 || draft.other
  const choice = (
    key: string,
    on: boolean,
    onClick: () => void,
    title: string,
    description?: string,
    badge?: boolean,
  ) => (
    <button
      key={key}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
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
        {on && <span className={cn('size-1.5 bg-accent-on', q.multiSelect ? 'rounded-sm' : 'rounded-full')} />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-ui">
          {title}
          {badge && (
            <span className="rounded-full bg-accent-soft px-1.5 text-label font-medium text-accent-fg">
              {L('推荐', 'Recommended')}
            </span>
          )}
        </span>
        {description && <span className="block text-meta text-fg-muted">{description}</span>}
      </span>
    </button>
  )
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-ui font-medium">{q.question}</legend>
      {q.multiSelect && (
        <span className="-mt-1 text-label text-fg-muted">{L('可以多选', 'Select all that apply')}</span>
      )}
      {q.options.map(o =>
        choice(
          o.label,
          draft.picks.includes(o.label),
          () => onChange(pickOption(q, draft, o.label)),
          displayLabel(o.label),
          o.description,
          isRecommended(o.label),
        ),
      )}
      {writeIn &&
        q.options.length > 0 &&
        choice(
          '__other',
          draft.other,
          () => onChange(toggleOther(q, draft)),
          L('其他（自己填）', 'Other (write your own)'),
        )}
      {writing &&
        (q.secret ? (
          <input
            type="password"
            value={draft.text}
            disabled={disabled}
            autoComplete="off"
            placeholder={L('输入内容（不会显示出来）', 'Enter text (hidden)')}
            onChange={e => onChange({ ...draft, text: e.target.value })}
            className="min-h-11 rounded-xl border border-line bg-surface px-3.5 text-ui text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
        ) : (
          <textarea
            value={draft.text}
            disabled={disabled}
            rows={2}
            placeholder={L('写下你的回答', 'Write your answer')}
            onChange={e => onChange({ ...draft, text: e.target.value })}
            className="field-sizing-content max-h-40 min-h-11 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-ui text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
        ))}
    </fieldset>
  )
}
