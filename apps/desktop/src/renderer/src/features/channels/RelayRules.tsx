// 频道设置里的「接力规则」（docs/ui/relay-limits-mockup.html）：AI 成员互相派活到哪个上限停下等你。
// 预设（谨慎 / 标准 / 长期任务）一键填好，改任何一项就是「自定义」；下面一行写明会在什么情况停下
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Segmented, Select, cn } from '@/ui'
import {
  RELAY_DURATIONS,
  RELAY_HOPS_MAX,
  RELAY_PAIR_MAX,
  RELAY_PRESETS,
  RELAY_WINDOWS,
  relayPresetOf,
  type RelayPreset,
  type RelayRules,
} from '../../../../shared/types/channels'

/** 分钟 → 「30 分钟」「4 小时」 */
export function relayDuration(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0
    ? tr('channels.relay.hours', { n: minutes / 60 })
    : tr('channels.relay.minutes', { n: minutes })
}

/** 会在什么情况停下：一句话 */
export function relaySummary(rules: RelayRules): string {
  const parts = [
    rules.hops !== null ? tr('channels.relay.summaryHops', { n: rules.hops }) : '',
    rules.pair !== null
      ? tr('channels.relay.summaryPair', { n: rules.pair, window: relayDuration(rules.windowMinutes) })
      : '',
    rules.maxMinutes !== null ? tr('channels.relay.summaryDuration', { time: relayDuration(rules.maxMinutes) }) : '',
  ].filter(Boolean)
  return parts.length
    ? tr('channels.relay.summary', { list: parts.join(tr('channels.relay.summarySep')) })
    : tr('channels.relay.never')
}

const NUMBER =
  'h-7 w-16 rounded-md border border-line bg-surface px-1.5 text-center text-meta text-fg tabular-nums outline-none focus:border-accent-line disabled:opacity-45'

/** 次数输入：1～max 的整数；空着或不对时按 1 */
function count(text: string, max: number): number {
  const n = Math.floor(Number(text))
  return Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : 1
}

export function RelayRulesEditor({ value, onChange }: { value: RelayRules; onChange: (rules: RelayRules) => void }) {
  useI18n()
  const preset = relayPresetOf(value) ?? 'custom'
  const set = (patch: Partial<RelayRules>) => onChange({ ...value, ...patch })
  const presets: Array<RelayPreset | 'custom'> = ['careful', 'standard', 'long', 'custom']
  const unlimited = value.hops === null && value.pair === null && value.maxMinutes === null
  const check = (checked: boolean, label: string, onToggle: (on: boolean) => void) => (
    <label className="flex items-center gap-1 text-fg-muted">
      <input type="checkbox" checked={checked} onChange={e => onToggle(e.target.checked)} />
      {label}
    </label>
  )
  return (
    <div data-relay-rules className="flex flex-col gap-2.5 rounded-lg border border-line bg-subtle/40 p-3">
      <span className="text-meta font-medium text-fg-muted">{tr('channels.relay.rules')}</span>
      <Segmented<RelayPreset | 'custom'>
        label={tr('channels.relay.rules')}
        value={preset}
        options={presets.map(p => ({ value: p, label: tr(`channels.relay.preset.${p}`) }))}
        // 「自定义」只是说明现在的规则不是预设，点它不改任何值
        onChange={p => p !== 'custom' && onChange({ ...RELAY_PRESETS[p], notify: value.notify })}
      />
      <div className="flex flex-wrap items-center gap-2 text-meta text-fg-secondary">
        {tr('channels.relay.hops')}
        <input
          type="number"
          min={1}
          max={RELAY_HOPS_MAX}
          className={NUMBER}
          disabled={value.hops === null}
          value={value.hops ?? ''}
          onChange={e => set({ hops: count(e.target.value, RELAY_HOPS_MAX) })}
        />
        {tr('channels.relay.hopsUnit')}
        {check(value.hops === null, tr('channels.relay.unlimited'), on => set({ hops: on ? null : 20 }))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-meta text-fg-secondary">
        {tr('channels.relay.pair')}
        <Select<string>
          label={tr('channels.relay.pair')}
          className="w-28!"
          disabled={value.pair === null}
          value={String(value.windowMinutes)}
          options={RELAY_WINDOWS.map(m => ({ value: String(m), label: relayDuration(m) }))}
          onChange={v => set({ windowMinutes: Number(v) })}
        />
        {tr('channels.relay.pairMid')}
        <input
          type="number"
          min={1}
          max={RELAY_PAIR_MAX}
          className={NUMBER}
          disabled={value.pair === null}
          value={value.pair ?? ''}
          onChange={e => set({ pair: count(e.target.value, RELAY_PAIR_MAX) })}
        />
        {tr('channels.relay.pairUnit')}
        {check(value.pair === null, tr('channels.relay.unlimited'), on => set({ pair: on ? null : 6 }))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-meta text-fg-secondary">
        {tr('channels.relay.duration')}
        <Select<string>
          label={tr('channels.relay.duration')}
          className="w-28!"
          value={value.maxMinutes === null ? '' : String(value.maxMinutes)}
          options={[
            { value: '', label: tr('channels.relay.unlimited') },
            ...RELAY_DURATIONS.map(m => ({ value: String(m), label: relayDuration(m) })),
          ]}
          onChange={v => set({ maxMinutes: v ? Number(v) : null })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-meta text-fg-secondary">
        {tr('channels.relay.onLimit')}
        <Select<'notify' | 'ask'>
          label={tr('channels.relay.onLimit')}
          className="w-52!"
          value={value.notify ? 'notify' : 'ask'}
          options={[
            { value: 'notify', label: tr('channels.relay.onLimitNotify') },
            { value: 'ask', label: tr('channels.relay.onLimitAsk') },
          ]}
          onChange={v => set({ notify: v === 'notify' })}
        />
      </div>
      <p data-relay-summary className="rounded-md bg-subtle px-2.5 py-1.5 text-meta text-fg-muted">
        {relaySummary(value)}
      </p>
      {unlimited && <p className={cn('text-meta text-warn')}>{tr('channels.relay.neverWarn')}</p>}
    </div>
  )
}
