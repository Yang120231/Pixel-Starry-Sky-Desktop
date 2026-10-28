// 开工弹窗：这次用哪些 AI、每一步交给谁、用什么模型和推理强度（mockup：频道群聊界面美化.html 的「开工」）
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState } from 'react'
import type { Effort } from '@pixelsky/protocol'
import { cn, Select, type SelectOption } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useEngineState } from '@/features/engine'
import { useEngineCatalog } from '@/features/engine/catalog'
import { effortLabel } from '@/features/engine/labels'
import { usePlatformCatalog } from '@/features/account/platform'
import { useProviders } from '@/features/account/providers'
import type { AgentMember, ChannelMember } from '@/data/types'
import type { FlowStepInput, FlowStepSettings } from '../../../../shared/types/channels'
import { agentMeta, MemberAvatar } from './ChannelMessage'
import { modelChoices, sourceKeyOf, type SourceContext } from './agentSource'
import { assignSteps, cleanStepSettings, effortEdge, finalSteps, type PlannedStep } from './startPlan'

type Preset = 'cheap' | 'balance' | 'max'
const PRESETS: Preset[] = ['cheap', 'balance', 'max']

const keyOf = (p: PlannedStep): string => `${p.step.id}|${p.to ?? ''}`
const busyText = (m: AgentMember): string | null =>
  m.task
    ? tr('channels.start.busy', { task: m.task })
    : m.queued
      ? tr('channels.start.queued', { count: m.queued })
      : null

export function StartDialog({
  steps,
  agents,
  membersById,
  busy,
  onConfirm,
  onCancel,
}: {
  steps: readonly FlowStepInput[]
  /** 这个频道里的 AI 成员 */
  agents: readonly ChannelMember[]
  membersById: ReadonlyMap<string, ChannelMember>
  busy: boolean
  onConfirm: (steps: FlowStepInput[]) => void
  onCancel: () => void
}) {
  useI18n()
  const list = agents.flatMap(m => (m.kind === 'agent' ? [m] : []))
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(list.map(m => m.id)))
  // 每一步的模型和推理强度：按「步骤 + 这次的人」记，换了人就按新的人重新给建议
  const [cfg, setCfg] = useState<Record<string, FlowStepSettings>>({})
  const engines = useEngineState(s => s.engines)
  const platform = usePlatformCatalog()
  const { providers } = useProviders()
  const sourceCtx: SourceContext = { email: platform.email, groups: platform.groups, providers }

  const pool = list.filter(m => picked.has(m.id)).map(m => m.id)
  const busyIds = new Set(list.filter(busyText).map(m => m.id))
  const plan = assignSteps(steps, pool, busyIds)
  const agentOf = (id: string | null): AgentMember | undefined => {
    const m = id ? membersById.get(id) : undefined
    return m?.kind === 'agent' ? m : undefined
  }
  const effortsOf = (id: string | null): readonly Effort[] | undefined =>
    engines.find(e => e.id === agentOf(id)?.engine)?.caps?.efforts
  // 建议 = 这一步原来的设置（牵头 AI 拆的时候可能给了推理强度）；换给了别的引擎的人，模型就不沿用了
  const baseOf = (p: PlannedStep): FlowStepSettings => {
    const orig = { ...cleanStepSettings(p.step.settings ?? {}) }
    if (p.moved && agentOf(p.step.memberId)?.engine !== agentOf(p.to)?.engine) delete orig.model
    return orig
  }
  const cfgOf = (p: PlannedStep): FlowStepSettings => cfg[keyOf(p)] ?? baseOf(p)
  const patch = (p: PlannedStep, next: FlowStepSettings) =>
    setCfg(prev => ({ ...prev, [keyOf(p)]: { ...cfgOf(p), ...next } }))
  const presetEffort = (p: PlannedStep, preset: Preset): Effort | undefined =>
    preset === 'balance'
      ? (baseOf(p).effort ?? undefined)
      : effortEdge(effortsOf(p.to), preset === 'cheap' ? 'low' : 'high')
  const applyPreset = (preset: Preset) =>
    setCfg(prev => {
      const next = { ...prev }
      for (const p of plan) if (p.to) next[keyOf(p)] = { ...cfgOf(p), effort: presetEffort(p, preset) }
      return next
    })
  const assigned = plan.filter(p => p.to)
  const activePreset = assigned.length
    ? PRESETS.find(k => assigned.every(p => cfgOf(p).effort === presetEffort(p, k)))
    : undefined
  const toggle = (id: string, on: boolean) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const only = pool.length === 1 ? agentOf(pool[0]) : undefined
  const none = pool.length === 0

  return (
    <ConfirmDialog
      wide
      title={tr('channels.start.title')}
      confirmLabel={tr('channels.start.confirm', { count: pool.length })}
      cancelLabel={tr('channels.start.cancel')}
      busy={busy}
      confirmDisabled={none || assigned.length === 0}
      onConfirm={() => onConfirm(finalSteps(plan, cfgOf))}
      onCancel={onCancel}
      description={
        <div className="flex flex-col gap-2 text-ui">
          <p className="text-meta text-fg-muted">{tr('channels.start.intro')}</p>
          {list.map(m => {
            const on = picked.has(m.id)
            const hint = busyText(m)
            return (
              <label
                key={m.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2',
                  on ? 'border-accent bg-accent-soft' : 'border-line opacity-60',
                )}
              >
                <input type="checkbox" checked={on} onChange={e => toggle(m.id, e.target.checked)} />
                <MemberAvatar member={m} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{m.name}</span>
                  <span className="block truncate text-meta text-fg-muted">{agentMeta(m)}</span>
                </span>
                {hint ? (
                  <span className="max-w-48 shrink-0 truncate text-meta text-warn" title={hint}>
                    {hint}
                  </span>
                ) : (
                  <span className="shrink-0 text-meta text-fg-faint">{tr('channels.start.idle')}</span>
                )}
              </label>
            )
          })}
          {only && (
            <p className="rounded-md bg-subtle px-2.5 py-1.5 text-meta text-fg-muted">
              {tr('channels.start.only', { name: only.name })}
            </p>
          )}
          <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-2.5">
            <span className="text-meta font-medium text-fg-muted">{tr('channels.start.steps')}</span>
            {assigned.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-meta text-fg-muted">
                {tr('channels.start.presets')}
                {PRESETS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => applyPreset(k)}
                    className={cn(
                      'press rounded-full border px-2.5 py-px',
                      activePreset === k
                        ? 'border-transparent bg-accent-soft font-medium text-accent-fg'
                        : 'border-line text-fg-muted hover:bg-hover',
                    )}
                  >
                    {tr(`channels.start.preset.${k}`)}
                  </button>
                ))}
              </div>
            )}
            {plan.length === 0 && <p className="text-meta text-warn">{tr('channels.start.noSteps')}</p>}
            {plan.map((p, i) => (
              <StepRow
                key={keyOf(p)}
                index={i}
                plan={p}
                member={agentOf(p.to)}
                value={cfgOf(p)}
                suggestion={baseOf(p)}
                efforts={effortsOf(p.to)}
                sourceCtx={sourceCtx}
                onChange={next => patch(p, next)}
              />
            ))}
          </div>
          <p className={cn('text-meta', none ? 'text-warn' : 'text-fg-faint')}>
            {none
              ? tr('channels.start.noneChecked')
              : tr('channels.start.summary', { ai: pool.length, steps: assigned.length })}
          </p>
        </div>
      }
    />
  )
}

/** 一步：交给谁（改派了标出来）、模型、推理强度；和建议不一样时能一键恢复 */
function StepRow({
  index,
  plan,
  member,
  value,
  suggestion,
  efforts,
  sourceCtx,
  onChange,
}: {
  index: number
  plan: PlannedStep
  member: AgentMember | undefined
  value: FlowStepSettings
  suggestion: FlowStepSettings
  efforts: readonly Effort[] | undefined
  sourceCtx: SourceContext
  onChange: (next: FlowStepSettings) => void
}) {
  useI18n()
  const catalog = useEngineCatalog(member?.engine ?? 'claude')
  const follow = tr('channels.flow.follow')
  const ownModels = (catalog?.models ?? []).map(m => ({ id: m.id, label: m.label }))
  const choices = member ? modelChoices(member.engine, sourceKeyOf(member.config?.settings), sourceCtx, ownModels) : []
  const modelOptions: SelectOption<string>[] = [
    { value: '', label: follow },
    ...choices.map(m => ({ value: m.id, label: m.label, hint: m.id !== m.label ? m.id : undefined })),
    ...(value.model && !choices.some(m => m.id === value.model) ? [{ value: value.model, label: value.model }] : []),
  ]
  const effortOptions: SelectOption<Effort | ''>[] = [
    { value: '', label: follow },
    ...(efforts ?? []).map(e => ({ value: e, label: effortLabel(e) })),
    ...(value.effort && !efforts?.includes(value.effort)
      ? [{ value: value.effort, label: effortLabel(value.effort) }]
      : []),
  ]
  const same = value.model === suggestion.model && value.effort === suggestion.effort
  const hasSuggestion = !!(suggestion.model || suggestion.effort)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2 text-ui">
        <span className="w-4 shrink-0 text-right text-meta text-fg-faint">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-fg" title={plan.step.title}>
          {plan.step.title}
        </span>
        {member ? (
          <span className="flex max-w-40 shrink-0 items-center gap-1 text-meta text-fg-muted">
            <MemberAvatar member={member} size={16} />
            <span className="truncate">{member.name}</span>
          </span>
        ) : (
          <span className="shrink-0 text-meta text-warn">{tr('channels.start.nobody')}</span>
        )}
        {plan.moved && member && (
          <span className="shrink-0 rounded-md bg-subtle px-1.5 py-px text-meta text-warn">
            {tr('channels.start.moved')}
          </span>
        )}
      </div>
      {member && (
        <div className="flex flex-wrap items-center gap-1.5 pl-6 text-meta text-fg-muted">
          <span>{tr('channels.start.model')}</span>
          <Select
            label={tr('channels.start.model')}
            value={value.model ?? ''}
            options={modelOptions}
            onChange={v => onChange({ model: v || undefined })}
            mono={!!value.model}
            className="w-40"
          />
          <span className="ml-1">{tr('channels.start.effort')}</span>
          <Select
            label={tr('channels.start.effort')}
            value={value.effort ?? ''}
            options={effortOptions}
            onChange={v => onChange({ effort: v || undefined })}
            className="w-28"
          />
          {same ? (
            hasSuggestion && (
              <span className="rounded border border-line bg-subtle px-1 text-[10.5px] text-fg-muted">
                {tr('channels.start.suggested')}
              </span>
            )
          ) : (
            <button
              type="button"
              className="px-1 text-accent hover:underline"
              onClick={() => onChange({ model: suggestion.model, effort: suggestion.effort })}
            >
              {tr('channels.start.restore')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
