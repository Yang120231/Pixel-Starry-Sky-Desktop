import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useEffect, useRef, useState } from 'react'
import { Plus, Settings2, Workflow, X } from 'lucide-react'
import type { Effort } from '@pixelsky/protocol'
import { Button, cn, IconButton, Popover, Segmented, Select, Spinner, useToast, type SelectOption } from '@/ui'
import { useEngineState } from '@/features/engine'
import { effortLabel } from '@/features/engine/labels'
import type { ChannelMember, ChannelTask, ChannelTextMessage } from '@/data/types'
import type {
  ChannelFlow,
  FlowAction,
  FlowStep,
  FlowStepInput,
  FlowStepKind,
  FlowStepSettings,
} from '../../../../shared/types/channels'
import { MemberAvatar } from './ChannelMessage'
import { GateActions } from './GateActions'
import { channelActions, useChannels } from './store'
import { saveTemplate, TEMPLATE_MAX, TEMPLATE_NAME_MAX, toTemplate } from './flowTemplates'

const NUMBERS = '①②③④⑤⑥⑦⑧⑨'
const num = (i: number): string => NUMBERS[i] ?? String(i + 1)
const AUTOSAVE_MS = 600

type Members = ReadonlyMap<string, ChannelMember>

/** 流程操作：失败（校验不过、状态不对）用 toast 说明 */
function useFlowRun(channelId: string) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = (action: FlowAction): Promise<boolean> => {
    setBusy(true)
    return channelActions
      .flow(channelId, action)
      .then(() => true)
      .catch((e: unknown) => {
        toast(tr('channels.flow.failed', { error: translateMessage((e as Error)?.message ?? String(e)) }))
        return false
      })
      .finally(() => setBusy(false))
  }
  return { run, busy }
}

const toInput = (s: FlowStep | FlowStepInput): FlowStepInput => ({
  id: s.id,
  title: s.title,
  memberId: s.memberId,
  deps: s.deps,
  kind: s.kind,
  ...(s.target ? { target: s.target } : {}),
  ...(s.gate ? { gate: true } : {}),
  ...(s.settings && Object.keys(s.settings).length ? { settings: s.settings } : {}),
})

/** 一步的临时设置（第 20 项）：不写的跟随成员 */
function StepSettings({
  member,
  value,
  onChange,
  gate,
  onGate,
}: {
  member: ChannelMember | undefined
  value: FlowStepSettings
  onChange: (next: FlowStepSettings) => void
  gate: boolean
  onGate: (next: boolean) => void
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const engine = member?.kind === 'agent' ? member.engine : null
  const caps = useEngineState(s => s.engines.find(e => e.id === engine)?.caps)
  const follow = tr('channels.flow.follow')
  const toggle = (v: boolean | undefined) => (v === undefined ? '' : v ? 'on' : 'off')
  const toggleOptions: SelectOption<'' | 'on' | 'off'>[] = [
    { value: '', label: follow },
    { value: 'on', label: tr('channels.agent.on') },
    { value: 'off', label: tr('channels.agent.off') },
  ]
  const set = (patch: FlowStepSettings) => {
    const next = { ...value, ...patch }
    for (const k of Object.keys(next) as (keyof FlowStepSettings)[]) if (next[k] === undefined) delete next[k]
    onChange(next)
  }
  const fromToggle = (v: '' | 'on' | 'off') => (v === '' ? undefined : v === 'on')
  const effortOptions: SelectOption<Effort | ''>[] = [
    { value: '', label: follow },
    ...(caps?.efforts ?? []).map(e => ({ value: e, label: effortLabel(e) })),
  ]
  const customized = Object.keys(value).length > 0 || gate
  return (
    <>
      <IconButton
        ref={anchor}
        icon={Settings2}
        iconSize={14}
        label={tr('channels.flow.settings')}
        size={26}
        active={customized}
        onClick={() => setOpen(o => !o)}
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="end"
        role="dialog"
        className="w-64 p-3"
      >
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2 text-ui text-fg">
            <input type="checkbox" checked={gate} onChange={e => onGate(e.target.checked)} />
            {tr('channels.flow.gateToggle')}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-fg-muted">{tr('channels.flow.model')}</span>
            <input
              value={value.model ?? ''}
              onChange={e => set({ model: e.target.value.trim() ? e.target.value : undefined })}
              className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-ui text-fg outline-none focus:border-accent"
            />
          </label>
          {effortOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-meta font-medium text-fg-muted">{tr('channels.agent.effort')}</span>
              <Select
                label={tr('channels.agent.effort')}
                value={value.effort ?? ''}
                options={effortOptions}
                onChange={v => set({ effort: v || undefined })}
              />
            </div>
          )}
          {(caps?.fast ?? true) && (
            <div className="flex flex-col gap-1">
              <span className="text-meta font-medium text-fg-muted">{tr('channels.agent.fast')}</span>
              <Select
                label={tr('channels.agent.fast')}
                value={toggle(value.fast) as '' | 'on' | 'off'}
                options={toggleOptions}
                onChange={v => set({ fast: fromToggle(v) })}
              />
            </div>
          )}
          {(caps?.ultracode ?? true) && (
            <div className="flex flex-col gap-1">
              <span className="text-meta font-medium text-ultracode">{tr('channels.agent.ultracode')}</span>
              <Select
                label={tr('channels.agent.ultracode')}
                value={toggle(value.ultracode) as '' | 'on' | 'off'}
                options={toggleOptions}
                onChange={v => set({ ultracode: fromToggle(v) })}
              />
            </div>
          )}
        </div>
      </Popover>
    </>
  )
}

/** 流程卡头上的「存为模板」：填个名字存到本机（docs/ui/channels-pipeline.md §8.1） */
function SaveTemplate({
  steps,
  limits,
  isolate,
  membersById,
}: {
  steps: readonly FlowStepInput[]
  limits?: ChannelFlow['limits']
  isolate?: boolean
  membersById: Members
}) {
  useI18n()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const anchor = useRef<HTMLSpanElement>(null)
  const save = () => {
    const n = name.trim()
    if (!n) return
    const lookup = (id: string) => {
      const m = membersById.get(id)
      return m ? { name: m.name, engine: m.kind === 'agent' ? m.engine : undefined } : undefined
    }
    if (!saveTemplate(toTemplate({ steps, limits, isolate }, n, lookup)))
      return toast(tr('channels.flow.tplFull', { n: TEMPLATE_MAX }))
    toast(tr('channels.flow.tplSaved', { name: n.slice(0, TEMPLATE_NAME_MAX) }))
    setOpen(false)
    setName('')
  }
  return (
    <>
      <span ref={anchor} className="inline-flex shrink-0">
        <Button className="h-7 px-2.5 text-meta" onClick={() => setOpen(o => !o)}>
          {tr('channels.flow.saveTpl')}
        </Button>
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="end"
        role="dialog"
        className="w-64 p-3"
      >
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            maxLength={TEMPLATE_NAME_MAX}
            aria-label={tr('channels.flow.tplName')}
            placeholder={tr('channels.flow.tplName')}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
            }}
            className="h-8 rounded-md border border-line bg-surface px-2 text-ui text-fg outline-none focus:border-accent"
          />
          <Button variant="primary" className="self-end" disabled={!name.trim()} onClick={save}>
            {tr('channels.flow.tplSave')}
          </Button>
        </div>
      </Popover>
    </>
  )
}

/** 时长的文字：1 分钟内秒、1 小时内分秒、再长小时 + 分 */
const durText = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return tr('channels.flow.dur.s', { s })
  const m = Math.floor(s / 60)
  return m < 60
    ? tr('channels.flow.dur.ms', { m, s: s % 60 })
    : tr('channels.flow.dur.hm', { h: Math.floor(m / 60), m: m % 60 })
}

/** 一步的耗时行：「3 分 12 秒 · 2 轮 · 打回 1 次」（§8.2）；没有的部分不显示 */
function stepStats(step: FlowStep, task: ChannelTask | undefined, now: number): string {
  if (!task) return ''
  const start = task.startedAt ?? task.at
  const parts = [
    start ? durText((task.endedAt ?? now) - start) : '',
    task.round ? tr('channels.flow.dur.rounds', { n: task.round }) : '',
    step.rejects > 0 ? tr('channels.flow.dur.rejects', { n: step.rejects }) : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

/** 整条流程的耗时：开始运行到最后一个任务结束（运行中到现在），不把并行的加起来 */
function flowTotal(flow: ChannelFlow, tasks: ChannelTask[], now: number): string {
  // 从最早那一步开始算（since 是护栏的计数起点，继续时会重置）
  const starts = tasks.map(t => t.startedAt ?? t.at)
  const start = starts.length ? Math.min(...starts) : flow.since?.at
  if (!start) return ''
  const ends = tasks.flatMap(t => (t.endedAt ? [t.endedAt] : []))
  const end = flow.status === 'running' ? now : Math.max(0, ...ends)
  if (end <= start) return ''
  const m = Math.round((end - start) / 60_000)
  const time = m < 1 ? durText(end - start) : m < 60 ? tr('channels.flow.dur.min', { m }) : durText(end - start)
  const rounds = tasks.reduce((n, t) => n + (t.round ?? 0), 0)
  return rounds > 0 ? tr('channels.flow.dur.total', { time, rounds }) : time
}

const newStepId = (steps: readonly FlowStepInput[]): string => {
  let id: string
  do id = 's' + crypto.randomUUID().slice(0, 4)
  while (steps.some(s => s.id === id))
  return id
}

function LimitInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (v: string) => void
}) {
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      placeholder={tr('channels.flow.limitsNone')}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
      className="h-6 w-14 rounded-md border border-line bg-surface px-1.5 text-center text-meta text-fg outline-none focus:border-accent"
    />
  )
}

/** 草稿：一行一步，改完自动保存；开始运行前先存一次 */
function DraftEditor({
  message,
  flow,
  agents,
  membersById,
  readOnly,
}: {
  message: ChannelTextMessage
  flow: ChannelFlow
  agents: readonly ChannelMember[]
  membersById: Members
  readOnly: boolean
}) {
  useI18n()
  const { run, busy } = useFlowRun(message.channelId)
  const [title, setTitle] = useState(flow.title)
  const [steps, setSteps] = useState<FlowStepInput[]>(() => flow.steps.map(toInput))
  // 旧流程没有护栏 = 不限；草稿里预填默认值（和主进程开始运行时补的一致）
  const [rounds, setRounds] = useState(() =>
    String(flow.limits ? (flow.limits.rounds ?? '') : Math.max(12, flow.steps.length * 4)),
  )
  const [minutes, setMinutes] = useState(() => String(flow.limits ? (flow.limits.minutes ?? '') : 120))
  const [isolate, setIsolate] = useState(flow.isolate !== false)
  const dirty = useRef(false)
  const edit = (change: (list: FlowStepInput[]) => FlowStepInput[]) => {
    dirty.current = true
    setSteps(change)
  }
  const patchStep = (id: string, patch: Partial<FlowStepInput>) =>
    edit(list => list.map(s => (s.id === id ? { ...s, ...patch } : s)))
  // 标题清空时先不存标题（主进程会拒绝整次更新），步骤照存
  const action = (): FlowAction => ({
    type: 'update',
    messageId: message.id,
    ...(title.trim() ? { title } : {}),
    steps,
    limits: { rounds: rounds.trim() ? Number(rounds) : null, minutes: minutes.trim() ? Number(minutes) : null },
    isolate,
  })

  const editLimit = (set: (v: string) => void, v: string) => {
    dirty.current = true
    set(v)
  }

  const pending = useRef(false)
  const save = useRef(() => {})
  save.current = () => {
    if (!pending.current) return
    pending.current = false
    void channelActions.flow(message.channelId, action()).catch(() => {})
  }
  useEffect(() => {
    if (!dirty.current) return
    pending.current = true
    const t = window.setTimeout(() => save.current(), AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [title, steps, rounds, minutes, isolate, message.channelId])
  // 切走频道时还没存的改动也存上
  useEffect(() => () => save.current(), [])

  const start = async () => {
    pending.current = false
    if (await run(action())) await run({ type: 'start', messageId: message.id })
  }
  const agentOptions: SelectOption<string>[] = agents.map(a => ({ value: a.id, label: a.name }))
  const kinds: { value: FlowStepKind; label: string }[] = [
    { value: 'work', label: tr('channels.flow.kind.work') },
    { value: 'review', label: tr('channels.flow.kind.review') },
    { value: 'summary', label: tr('channels.flow.kind.summary') },
  ]
  const toggleDep = (s: FlowStepInput, dep: string) =>
    patchStep(s.id, { deps: s.deps.includes(dep) ? s.deps.filter(d => d !== dep) : [...s.deps, dep] })
  const setKind = (s: FlowStepInput, kind: FlowStepKind) => {
    const target = kind === 'review' ? (s.target ?? s.deps[0] ?? steps.find(x => x.id !== s.id)?.id) : undefined
    patchStep(s.id, {
      kind,
      target,
      deps: target && !s.deps.includes(target) ? [...s.deps, target] : s.deps,
    })
  }
  const remove = (id: string) =>
    edit(list =>
      list
        .filter(s => s.id !== id)
        .map(s => ({ ...s, deps: s.deps.filter(d => d !== id), target: s.target === id ? undefined : s.target })),
    )
  const add = () =>
    edit(list => [
      ...list,
      {
        id: newStepId(list),
        title: '',
        memberId: agents[0]?.id ?? '',
        deps: list.length ? [list[list.length - 1].id] : [],
        kind: 'work',
      },
    ])

  return (
    <>
      <input
        aria-label={tr('channels.flow.titleLabel')}
        value={title}
        disabled={readOnly}
        onChange={e => {
          dirty.current = true
          setTitle(e.target.value)
        }}
        className="h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-ui font-semibold text-fg outline-none hover:border-line focus:border-accent"
      />
      <ol className="mt-2 flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-md border border-line-subtle bg-subtle/40 p-2" data-flow-draft-step={s.id}>
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-ui text-fg-muted">{num(i)}</span>
              <input
                aria-label={tr('channels.flow.stepTitle')}
                placeholder={tr('channels.flow.stepTitle')}
                value={s.title}
                disabled={readOnly}
                onChange={e => patchStep(s.id, { title: e.target.value })}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-ui text-fg outline-none focus:border-accent"
              />
              <div className="w-32 shrink-0">
                <Select
                  label={tr('channels.flow.member')}
                  value={s.memberId}
                  placeholder={tr('channels.flow.pickMember')}
                  options={agentOptions}
                  disabled={readOnly}
                  onChange={v => patchStep(s.id, { memberId: v })}
                />
              </div>
              <StepSettings
                member={membersById.get(s.memberId)}
                value={s.settings ?? {}}
                onChange={settings => patchStep(s.id, { settings })}
                gate={!!s.gate}
                onGate={gate => patchStep(s.id, { gate })}
              />
              <IconButton
                icon={X}
                iconSize={14}
                label={tr('channels.flow.removeStep')}
                size={26}
                onClick={() => remove(s.id)}
                disabled={readOnly}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7">
              <Segmented
                label={tr('channels.flow.kind')}
                options={kinds}
                value={s.kind}
                disabled={readOnly}
                onChange={k => setKind(s, k)}
              />
              {s.kind === 'review' && (
                <div className="w-36">
                  <Select
                    label={tr('channels.flow.target')}
                    value={s.target ?? ''}
                    placeholder={tr('channels.flow.target')}
                    options={steps.flatMap((x, j) =>
                      x.id === s.id ? [] : [{ value: x.id, label: `${num(j)} ${x.title}` }],
                    )}
                    disabled={readOnly}
                    onChange={v => patchStep(s.id, { target: v, deps: s.deps.includes(v) ? s.deps : [...s.deps, v] })}
                  />
                </div>
              )}
              {steps.length > 1 && (
                <span className="flex items-center gap-1" role="group" aria-label={tr('channels.flow.deps')}>
                  <span className="text-meta text-fg-faint">{tr('channels.flow.deps')}</span>
                  {steps.map((x, j) =>
                    x.id === s.id ? null : (
                      <button
                        key={x.id}
                        type="button"
                        aria-pressed={s.deps.includes(x.id)}
                        disabled={readOnly}
                        onClick={() => toggleDep(s, x.id)}
                        className={cn(
                          'h-6 min-w-6 rounded-md px-1.5 text-meta',
                          s.deps.includes(x.id)
                            ? 'bg-accent-soft text-accent-fg'
                            : 'bg-subtle text-fg-muted hover:bg-hover',
                        )}
                      >
                        {num(j)}
                      </button>
                    ),
                  )}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-meta text-fg-muted">
        {tr('channels.flow.limitsRow')}
        <LimitInput
          label={tr('channels.flow.limitsRoundsLabel')}
          value={rounds}
          disabled={readOnly}
          onChange={v => editLimit(setRounds, v)}
        />
        {tr('channels.flow.limitsRounds')} · {tr('channels.flow.limitsMid')}
        <LimitInput
          label={tr('channels.flow.limitsMinutesLabel')}
          value={minutes}
          disabled={readOnly}
          onChange={v => editLimit(setMinutes, v)}
        />
        {tr('channels.flow.limitsMinutes')}
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={isolate}
            disabled={readOnly}
            onChange={e => {
              dirty.current = true
              setIsolate(e.target.checked)
            }}
          />
          {tr('channels.flow.isolate')}
        </label>
      </div>
      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <Button icon={Plus} className="h-7 px-2.5" onClick={add} disabled={agents.length === 0}>
            {tr('channels.flow.addStep')}
          </Button>
          <span className="flex-1" />
          {steps.length > 0 && (
            <SaveTemplate
              steps={steps}
              isolate={isolate}
              limits={{
                rounds: rounds.trim() ? Number(rounds) : null,
                minutes: minutes.trim() ? Number(minutes) : null,
              }}
              membersById={membersById}
            />
          )}
          <Button disabled={busy} onClick={() => void run({ type: 'discard', messageId: message.id })}>
            {tr('channels.flow.discard')}
          </Button>
          <Button variant="primary" disabled={busy || steps.length === 0} onClick={() => void start()}>
            {tr('channels.flow.start')}
          </Button>
        </div>
      )}
    </>
  )
}

const limitText = (kind: 'Rounds' | 'Minutes', n: number | null): string =>
  n == null ? tr('channels.flow.limitsNone') : tr(`channels.flow.limitsShown${kind}`, { n })

/** 一步现在的状态文字 */
function stepStatus(flow: ChannelFlow, step: FlowStep, membersById: Members): { text: string; running: boolean } {
  const byId = new Map(flow.steps.map((s, i) => [s.id, { s, i }]))
  const target = step.target ? byId.get(step.target)?.s : undefined
  const rejected = step.kind === 'review' && target && target.rejects > 0
  const rejectText = () => tr('channels.flow.step.rejected', { count: target?.rejects ?? 0, max: flow.maxRejects })
  switch (step.status) {
    case 'pending': {
      const waiting = step.deps.flatMap(d => {
        const dep = byId.get(d)
        return dep && dep.s.status !== 'delivered' ? [num(dep.i)] : []
      })
      if (rejected) return { text: rejectText(), running: false }
      return {
        text: waiting.length
          ? tr('channels.flow.step.waitDeps', { steps: waiting.join('') })
          : tr('channels.flow.step.notStarted'),
        running: false,
      }
    }
    case 'running':
      return { text: tr('channels.flow.step.running'), running: true }
    case 'asking': {
      const to = [...(flow.asks ?? [])].reverse().find(a => a.from === step.memberId)?.to
      const name = to ? membersById.get(to)?.name : undefined
      return {
        text: name ? tr('channels.flow.step.asking', { name }) : tr('channels.flow.step.askingAny'),
        running: true,
      }
    }
    case 'gated':
      return { text: tr('channels.flow.step.gated'), running: false }
    case 'delivered':
      if (step.kind === 'review')
        return {
          text: step.result?.verdict === 'reject' ? rejectText() : tr('channels.flow.step.pass'),
          running: false,
        }
      return { text: tr('channels.flow.step.delivered'), running: false }
    case 'failed':
      return { text: tr('channels.flow.step.failed'), running: false }
    case 'stopped':
      return { text: tr('channels.flow.step.stopped'), running: false }
  }
}

const STEP_TONE: Record<FlowStep['status'], string> = {
  pending: 'bg-subtle text-fg-muted',
  running: 'bg-accent-soft text-accent-fg',
  asking: 'bg-accent-soft text-accent-fg',
  gated: 'bg-subtle text-warn',
  delivered: 'bg-subtle text-success',
  failed: 'bg-subtle text-danger',
  stopped: 'bg-subtle text-fg-faint',
}

/** 流程卡（docs/ui/channels-pipeline.md §4.5）：规划中 / 草稿 / 运行中的步骤列表 */
export function ChannelFlowCard({
  message,
  membersById,
  channelMembers,
  readOnly = false,
  highlight = false,
}: {
  message: ChannelTextMessage
  membersById: Members
  channelMembers: readonly ChannelMember[]
  /** 归档的频道只读 */
  readOnly?: boolean
  highlight?: boolean
}) {
  useI18n()
  const flow = message.flow!
  const { run, busy } = useFlowRun(message.channelId)
  const gate = (stepId: string, decision: 'approve' | 'reject', note?: string) =>
    void run({ type: 'gate', messageId: message.id, stepId, decision, ...(note ? { note } : {}) })
  const act = (type: 'pause' | 'resume' | 'stop' | 'discard') => void run({ type, messageId: message.id })
  const agents = channelMembers.filter(m => m.kind === 'agent')
  const planner = flow.planner ? membersById.get(flow.planner.memberId) : undefined
  const channelMessages = useChannels(s => s.messages[message.channelId])
  const taskOf = new Map<string, ChannelTask>()
  for (const m of channelMessages ?? []) if (m.kind === 'task') taskOf.set(m.id, m)
  const tasks = flow.steps.flatMap(s => (s.taskId && taskOf.get(s.taskId) ? [taskOf.get(s.taskId)!] : []))
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (flow.status !== 'running') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [flow.status])
  const total = flow.status === 'draft' || flow.status === 'planning' ? '' : flowTotal(flow, tasks, now)
  const tone =
    flow.status === 'paused'
      ? 'bg-subtle text-warn'
      : flow.status === 'running'
        ? 'bg-accent-soft text-accent-fg'
        : flow.status === 'done'
          ? 'bg-subtle text-success'
          : 'bg-subtle text-fg-muted'
  return (
    <div className="conversation-message mt-3 pl-10" data-channel-message={message.id}>
      <article
        aria-label={`${tr('channels.flow.label')}：${flow.title}`}
        data-flow-status={flow.status}
        className={cn(
          'max-w-[640px] rounded-lg border border-line-card bg-surface p-3 shadow-sm',
          flow.status === 'paused' && 'border-warn/40',
          highlight && 'search-hit',
        )}
      >
        {flow.status === 'draft' ? (
          <DraftEditor message={message} flow={flow} agents={agents} membersById={membersById} readOnly={readOnly} />
        ) : (
          <>
            <div className="flex items-center gap-2 text-meta">
              <Workflow size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate text-ui font-semibold text-fg">{flow.title}</span>
              {flow.planner?.auto && (
                <span className="max-w-40 shrink-0 truncate text-fg-faint">
                  {tr('channels.flow.autoPlan', { name: planner?.name ?? '?' })}
                </span>
              )}
              <span className={cn('shrink-0 rounded-md px-1.5 py-0.5', tone)}>
                {tr(`channels.flow.status.${flow.status}`)}
              </span>
              {flow.steps.length > 0 && (
                <SaveTemplate
                  steps={flow.steps}
                  limits={flow.limits}
                  isolate={flow.isolate}
                  membersById={membersById}
                />
              )}
            </div>
            {flow.status === 'paused' && flow.paused && (
              <p className="mt-1 text-meta text-warn">
                {tr(
                  flow.paused.reason === 'limit' && flow.paused.limit
                    ? `channels.flow.pause.limit.${flow.paused.limit}`
                    : `channels.flow.pause.${flow.paused.reason}`,
                )}
              </p>
            )}
            {flow.status === 'planning' ? (
              <div className="mt-2 flex items-center gap-2 text-ui text-fg-muted">
                <Spinner size={13} />
                <span className="min-w-0 flex-1 truncate">
                  {tr('channels.flow.planning', { name: planner?.name ?? '?' })}
                </span>
                {!readOnly && (
                  <Button className="h-7 px-2.5" disabled={busy} onClick={() => act('discard')}>
                    {tr('channels.flow.cancel')}
                  </Button>
                )}
              </div>
            ) : (
              <ol className="mt-2 flex flex-col">
                {flow.steps.map((s, i) => {
                  const st = stepStatus(flow, s, membersById)
                  const member = membersById.get(s.memberId)
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={!s.taskId}
                        aria-label={tr('channels.flow.step.open', { n: i + 1 })}
                        onClick={() => s.taskId && void channelActions.focusMessage(message.channelId, s.taskId)}
                        className="flex w-full min-w-0 flex-col gap-0.5 rounded-md px-1.5 py-1.5 text-left enabled:hover:bg-hover"
                      >
                        <span className="flex w-full min-w-0 items-center gap-2">
                          <span className="w-5 shrink-0 text-center text-ui text-fg-muted">{num(i)}</span>
                          <span className="min-w-0 flex-1 truncate text-ui text-fg">{s.title}</span>
                          <MemberAvatar member={member} size={18} />
                          <span className="max-w-24 shrink-0 truncate text-meta text-fg-muted">
                            {member?.name ?? '?'}
                          </span>
                          <span
                            className={cn(
                              'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-meta',
                              STEP_TONE[s.status],
                            )}
                          >
                            {st.running && <Spinner size={10} />}
                            {st.text}
                          </span>
                        </span>
                        {(() => {
                          const stats = stepStats(s, s.taskId ? taskOf.get(s.taskId) : undefined, now)
                          return stats && <span className="truncate pl-7 text-meta text-fg-faint">{stats}</span>
                        })()}
                        {s.copy && (
                          <span className="truncate pl-7 text-meta text-fg-faint">
                            {tr('channels.flow.copy', { branch: s.copy.branch })}
                          </span>
                        )}
                        {(s.status === 'delivered' || s.status === 'gated') && s.result?.summary && (
                          <span className="truncate pl-7 text-meta text-fg-faint">{s.result.summary}</span>
                        )}
                      </button>
                      {s.status === 'gated' && !readOnly && (flow.status === 'running' || flow.status === 'paused') && (
                        <div
                          className="flex items-center justify-end gap-1.5 pt-0.5 pr-1.5 pb-1.5 pl-8"
                          data-flow-gate={s.id}
                        >
                          <GateActions
                            disabled={busy}
                            onApprove={() => gate(s.id, 'approve')}
                            onReject={note => gate(s.id, 'reject', note)}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
            {total && <p className="mt-1.5 px-1.5 text-meta text-fg-faint">{total}</p>}
            {!readOnly && (flow.status === 'running' || flow.status === 'paused') && (
              <div className="mt-2 flex items-center justify-end gap-2">
                {flow.limits && (
                  <span className="mr-auto text-meta text-fg-faint">
                    {tr('channels.flow.limitsShown', {
                      rounds: limitText('Rounds', flow.limits.rounds),
                      minutes: limitText('Minutes', flow.limits.minutes),
                    })}
                  </span>
                )}
                {flow.status === 'running' ? (
                  <Button className="h-7 px-2.5" disabled={busy} onClick={() => act('pause')}>
                    {tr('channels.flow.pause')}
                  </Button>
                ) : (
                  <Button variant="primary" className="h-7 px-2.5" disabled={busy} onClick={() => act('resume')}>
                    {tr(flow.paused?.reason === 'limit' ? 'channels.flow.resumeLimit' : 'channels.flow.resume')}
                  </Button>
                )}
                <Button className="h-7 px-2.5" disabled={busy} onClick={() => act('stop')}>
                  {tr('channels.flow.stop')}
                </Button>
              </div>
            )}
          </>
        )}
      </article>
    </div>
  )
}
