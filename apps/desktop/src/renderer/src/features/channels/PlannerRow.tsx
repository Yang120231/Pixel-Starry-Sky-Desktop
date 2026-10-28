// 拟计划的流程在时间线上是拟计划的成员在说话：左边它的头像、名字，一句开场白，下面是流程卡；
// 你那条 @ 下面只留一行「交给谁 · 计划模式」
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState, type ReactNode } from 'react'
import type { ChannelMember, ChannelTextMessage } from '@/data/types'
import { AuthorLine, MemberAvatar } from './ChannelMessage'
import type { FlowPart } from './model'

/** 卡前面的开场白：问你问题时说要定几件，出了草稿说还没开工；拟计划中、开工后不说（卡上有进度） */
export function plannerLead(message: ChannelTextMessage, part: FlowPart): string | null {
  const flow = message.flow
  if (!flow?.planner) return null
  const questions = flow.questions ?? []
  if (part === 'questions') return tr('channels.plan.leadAsk', { n: questions.length })
  if (flow.status !== 'draft') return null
  return questions.some(q => !q.answer)
    ? tr('channels.plan.leadAsk', { n: questions.length })
    : tr('channels.plan.leadDraft')
}

/** 「软件已读取计划 · 原始回复」：点开看拟计划的成员原样的回复 */
function RawReplies({ raw }: { raw: readonly string[] }) {
  useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-[620px] max-w-full flex-col gap-1 px-1 text-meta text-fg-faint" data-flow-raw>
      <span>
        {tr('channels.plan.parsed')} ·{' '}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          className="font-medium text-accent-fg hover:underline"
        >
          {tr('channels.plan.raw')}
        </button>
      </span>
      {open && (
        <pre className="max-h-48 overflow-auto rounded-md border border-line-subtle bg-subtle px-2.5 py-2 font-mono text-[11.5px] leading-5 break-words whitespace-pre-wrap text-fg-muted">
          {raw.join('\n\n')}
        </pre>
      )}
    </div>
  )
}

/** 拟计划的成员的一行：头像、作者行、开场白气泡、流程卡（children）、原始回复 */
export function PlannerRow({
  message,
  part,
  raw,
  membersById,
  children,
}: {
  message: ChannelTextMessage
  part: FlowPart
  raw?: readonly string[]
  membersById: ReadonlyMap<string, ChannelMember>
  children: ReactNode
}) {
  useI18n()
  const planner = message.flow?.planner ? membersById.get(message.flow.planner.memberId) : undefined
  const lead = plannerLead(message, part)
  return (
    <div className="conversation-message mt-3 flex gap-2.5" data-flow-row={part}>
      <div className="w-7 shrink-0 pt-0.5">
        <MemberAvatar member={planner} />
      </div>
      <div className="flex max-w-[min(calc(100%_-_38px),760px)] min-w-0 flex-1 flex-col items-start gap-1.5">
        <AuthorLine member={planner} />
        {lead && (
          <div
            data-bubble
            className="-mt-1 max-w-full min-w-0 rounded-2xl rounded-tl-md bg-subtle px-3 py-1.5 text-prose break-words whitespace-pre-wrap text-fg-body"
          >
            {lead}
          </div>
        )}
        {children}
        {!!raw?.length && <RawReplies raw={raw} />}
      </div>
    </div>
  )
}

/** 你那条 @ 下面的一行小字：交给谁 · 计划模式，点一下跳到它那边的计划卡 */
export function PlannerHandoff({
  flow,
  membersById,
  onJump,
}: {
  flow: ChannelTextMessage
  membersById: ReadonlyMap<string, ChannelMember>
  onJump: (id: string) => void
}) {
  useI18n()
  const planner = flow.flow?.planner ? membersById.get(flow.flow.planner.memberId) : undefined
  return (
    <button
      type="button"
      data-flow-handoff={flow.id}
      onClick={() => onJump(flow.id)}
      className="mt-0.5 inline-flex max-w-full min-w-0 items-center gap-1.5 rounded px-1 text-meta text-fg-faint hover:bg-hover hover:text-fg-muted"
    >
      <MemberAvatar member={planner} size={16} />
      <span className="min-w-0 truncate">{tr('channels.plan.handoff', { name: planner?.name ?? '?' })}</span>
    </button>
  )
}
