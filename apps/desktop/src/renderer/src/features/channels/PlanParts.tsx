// 计划阶段流程卡上的两块：拟计划的成员一次问完的问题（都答了才交给它）、换拟计划的成员 / 模型 / 推理强度
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useRef, useState } from 'react'
import type { Effort } from '@pixelsky/protocol'
import { Button, cn, Popover, Select, type SelectOption } from '@/ui'
import { useEngineState } from '@/features/engine'
import { useEngineCatalog } from '@/features/engine/catalog'
import { effortLabel } from '@/features/engine/labels'
import { usePlatformCatalog } from '@/features/account/platform'
import { useProviders } from '@/features/account/providers'
import type { AgentMember, ChannelMember, ChannelTextMessage } from '@/data/types'
import type { ChannelFlow, FlowStepSettings } from '../../../../shared/types/channels'
import { modelChoices, sourceKeyOf } from './agentSource'
import { useFlowRun } from './ChannelFlowCard'

/** 拟计划的成员开工前一次问完的问题：每个点选项或自己写，都答了才能交 */
export function QuestionsForm({
  message,
  flow,
  readOnly,
}: {
  message: ChannelTextMessage
  flow: ChannelFlow
  readOnly: boolean
}) {
  useI18n()
  const { run, busy } = useFlowRun(message.channelId)
  const questions = flow.questions ?? []
  const [answers, setAnswers] = useState<string[]>(() => questions.map(q => q.answer ?? ''))
  const set = (i: number, v: string) => setAnswers(a => a.map((x, j) => (j === i ? v : x)))
  const left = answers.filter(a => !a.trim()).length
  return (
    <section
      aria-label={tr('channels.plan.questions', { n: questions.length })}
      className="flex flex-col"
      data-flow-questions
    >
      {questions.map((q, i) => (
        <div key={i} className={cn('flex flex-col gap-1.5 pb-2', i > 0 && 'border-t border-dashed border-line pt-2')}>
          <span className="text-ui text-fg">
            <span className="mr-1 font-semibold text-warn">{i + 1}.</span>
            {q.q}
          </span>
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(o => (
                <button
                  key={o}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={answers[i] === o}
                  onClick={() => set(i, o)}
                  className={cn(
                    'h-7 rounded-full border px-3 text-meta',
                    answers[i] === o
                      ? 'border-transparent bg-primary text-primary-fg'
                      : 'border-line bg-surface text-fg hover:border-accent',
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <input
            aria-label={q.q}
            placeholder={tr('channels.plan.own')}
            disabled={readOnly}
            value={q.options.includes(answers[i]) ? '' : answers[i]}
            onChange={e => set(i, e.target.value)}
            className="h-7 rounded-md border border-line bg-surface px-2 text-meta text-fg outline-none focus:border-accent"
          />
        </div>
      ))}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="text-meta text-fg-faint">
            {left ? tr('channels.plan.left', { n: left }) : tr('channels.plan.ready')}
          </span>
          <Button
            variant="primary"
            className="h-7 px-3"
            disabled={busy || left > 0}
            onClick={() => void run({ type: 'answers', messageId: message.id, answers })}
          >
            {tr('channels.plan.submit')}
          </Button>
        </div>
      )}
    </section>
  )
}

/** 拟计划这一轮用的模型 · 推理强度（没换过的跟随成员，不写） */
export function plannerSummary(flow: ChannelFlow): string {
  const s = flow.planner?.settings
  return [s?.model, s?.effort && effortLabel(s.effort)].filter(Boolean).join(' · ')
}

/** 卡头上的「换」：开工前换人、换模型和推理强度，由新的重新出计划（谁在拟、用什么模型写在卡头别处） */
export function PlannerSwitch({
  message,
  flow,
  agents,
  readOnly,
}: {
  message: ChannelTextMessage
  flow: ChannelFlow
  agents: readonly ChannelMember[]
  readOnly: boolean
}) {
  useI18n()
  const { run, busy } = useFlowRun(message.channelId)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const planner = flow.planner!
  const [who, setWho] = useState(planner.memberId)
  const [settings, setSettings] = useState<FlowStepSettings>(planner.settings ?? {})
  const target = agents.find(a => a.id === who && a.kind === 'agent') as AgentMember | undefined
  if (readOnly || (flow.status !== 'draft' && flow.status !== 'planning')) return null
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-flow-planner
        onClick={() => {
          setWho(planner.memberId)
          setSettings(planner.settings ?? {})
          setOpen(o => !o)
        }}
        className="shrink-0 rounded px-1 text-meta font-medium text-accent-fg hover:bg-hover"
      >
        {tr('channels.plan.switch')}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="end"
        role="dialog"
        className="w-72 p-3"
      >
        <div className="flex flex-col gap-2.5">
          <span className="text-ui font-medium text-fg">{tr('channels.plan.switchTitle')}</span>
          <Select
            label={tr('channels.plan.who')}
            value={who}
            options={agents.filter(a => a.kind === 'agent').map(a => ({ value: a.id, label: a.name }))}
            onChange={v => {
              // 换了人：模型跟着引擎变，先回到跟随成员；推理强度留着
              if (v !== who) setSettings(s => (s.effort ? { effort: s.effort } : {}))
              setWho(v)
            }}
          />
          {target && <PlannerModel member={target} value={settings} onChange={setSettings} />}
          <p className="text-meta text-fg-faint">{tr('channels.plan.switchHint')}</p>
          <Button
            variant="primary"
            className="self-end"
            disabled={busy || !target}
            onClick={() =>
              void run({ type: 'replan', messageId: message.id, memberId: who, settings }).then(
                ok => ok && setOpen(false),
              )
            }
          >
            {tr('channels.plan.switchConfirm', { name: target?.name ?? '?' })}
          </Button>
        </div>
      </Popover>
    </>
  )
}

function PlannerModel({
  member,
  value,
  onChange,
}: {
  member: AgentMember
  value: FlowStepSettings
  onChange: (next: FlowStepSettings) => void
}) {
  useI18n()
  const catalog = useEngineCatalog(member.engine)
  const platform = usePlatformCatalog()
  const { providers } = useProviders()
  const efforts = useEngineState(s => s.engines.find(e => e.id === member.engine)?.caps?.efforts)
  const follow = tr('channels.flow.follow')
  const ownModels = (catalog?.models ?? []).map(m => ({ id: m.id, label: m.label }))
  const choices = modelChoices(
    member.engine,
    sourceKeyOf(member.config?.settings),
    { email: platform.email, groups: platform.groups, providers },
    ownModels,
  )
  const models: SelectOption<string>[] = [
    { value: '', label: follow },
    ...choices.map(m => ({ value: m.id, label: m.label })),
    ...(value.model && !choices.some(m => m.id === value.model) ? [{ value: value.model, label: value.model }] : []),
  ]
  const effortOptions: SelectOption<Effort | ''>[] = [
    { value: '', label: follow },
    ...(efforts ?? []).map(e => ({ value: e, label: effortLabel(e) })),
  ]
  const patch = (p: FlowStepSettings) => {
    const next: FlowStepSettings = { ...value, ...p }
    if (!next.model) delete next.model
    if (!next.effort) delete next.effort
    onChange(next)
  }
  return (
    <>
      <Select
        label={tr('channels.flow.model')}
        value={value.model ?? ''}
        options={models}
        onChange={v => patch({ model: v })}
      />
      <Select
        label={tr('channels.agent.effort')}
        value={value.effort ?? ''}
        options={effortOptions}
        onChange={v => patch({ effort: v || undefined })}
      />
    </>
  )
}
