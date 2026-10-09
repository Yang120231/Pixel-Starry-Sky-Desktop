import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 输入框里的弹出菜单：推理强度（滑块 + Ultracode）、权限模式（docs/engines.md §6、§11）。都从下往上弹出。
// 引擎 / 额度来源 / 模型菜单在 ModelSourceMenu.tsx（docs/ui/source-switch.md）。
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Brain, Check, ChevronDown, ListChecks, RotateCcw, Shield, ShieldCheck, ShieldOff, Sparkles, Zap, type LucideIcon } from 'lucide-react'
import type { PermissionMode } from '@pixelsky/protocol'
import { IconButton, Popover, cn } from '@/components/ui'
import { DEFAULT_EFFORT, EFFORT_LABEL, PERMISSION_INFO, effortLabel, type ComposerController } from '@/engine'
import { EffortSlider } from './EffortSlider'

export const PERMISSION_ICON: Record<PermissionMode, LucideIcon> = {
  ask: Shield,
  edits: ShieldCheck,
  plan: ListChecks,
  full: ShieldOff,
}

export function MenuTitle({ children }: { children: ReactNode }) {
  useI18n()
  return <div className="px-2 pt-1.5 pb-1 text-label font-medium text-fg-faint">{children}</div>
}

export function MenuRow({
  selected,
  disabled,
  onClick,
  icon,
  title,
  hint,
}: {
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
}) {
  useI18n()
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
        selected && 'bg-selected hover:bg-selected',
      )}
    >
      {icon && <span className="mt-0.5 flex shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-ui text-fg">{title}</span>
        {hint && <span className="block text-meta text-fg-muted">{hint}</span>}
      </span>
      {selected && <Check size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-fg-secondary" />}
    </button>
  )
}

export const TRIGGER =
  'press no-drag inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-list text-fg-secondary hover:bg-hover hover:text-fg'

/** 开关（Ultracode 等） */
export function Switch({ checked, disabled, label, tone, onChange }: { checked: boolean; disabled?: boolean; label: string; tone?: 'ultracode'; onChange: (on: boolean) => void }) {
  useI18n()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-tone={tone}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ui-switch relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full transition-colors duration-(--dur-base) disabled:opacity-50"
    >
      <span
        className={cn(
          'ui-switch-knob inline-block size-4 rounded-full transition-transform duration-(--dur-base) ease-(--ease-out)',
          checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

/** 开关一行：名字 + 说明 + 开关 */
function SwitchRow({
  icon,
  label,
  desc,
  checked,
  disabled,
  tone,
  onChange,
}: {
  icon?: ReactNode
  label: string
  desc: string
  checked: boolean
  disabled?: boolean
  tone?: 'ultracode'
  onChange: (on: boolean) => void
}) {
  useI18n()
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-ui text-fg">
          {icon}
          <span className={cn(tone === 'ultracode' && checked && 'effort-max ultracode-glow')}>{label}</span>
        </span>
        <span className="mt-0.5 block text-meta text-fg-muted">{desc}</span>
      </span>
      <Switch checked={checked} disabled={disabled} label={label} tone={tone} onChange={onChange} />
    </div>
  )
}

/**
 * 推理强度：滑块 + 下面的会话开关（Ultracode、Fast 模式、显示思考摘要，引擎支持时才出现）。
 * 配色和 JuCode 同步：强度名、滑块用引擎品牌色，最高档时流动（docs/engines.md §15）。
 */
export function EffortMenu({ live }: { live: ComposerController }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const { effort, efforts, ultracode, ultracodeSupported, ultracodeAvailable, accent } = live
  const top = !!effort && efforts.length > 1 && efforts.indexOf(effort) === efforts.length - 1
  const ultraUnavailable = ultracodeAvailable === false
  const fastUnavailable = live.fastAvailable === false
  const accentStyle = { '--effort-accent': accent || 'var(--text)' } as CSSProperties
  const hasSwitches = ultracodeSupported || live.fastSupported || live.thinkingSupported
  // 开启的会话开关同步显示在按钮上：Ultracode 用紫色文字，Fast / 思考摘要用强调色图标。
  const fastOn = live.fastSupported && live.fast
  const thinkingOn = live.thinkingSupported && live.thinkingSummaries
  const modes = [ultracode && 'Ultracode', fastOn && tr("session.ComposerMenus.message128"), thinkingOn && tr("session.ComposerMenus.message132")].filter(Boolean).join(' · ')
  const title = [tr("session.ComposerMenus.message124", { p0: effortLabel(effort) }), modes && tr("session.ComposerMenus.modesOn", { p0: modes })].filter(Boolean).join(' · ')
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(TRIGGER, 'gap-1')}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span key={effort ?? ''} className={cn(top && 'effort-max')} style={accentStyle}>
          {effortLabel(effort)}
        </span>
        {ultracode && <><span className="text-fg-muted">·</span><span className="effort-max ultracode-glow">Ultracode</span></>}
        {(fastOn || thinkingOn) && <span className="flex items-center gap-0.5 text-accent" aria-hidden>
          {fastOn && <Zap size={13} strokeWidth={1.75} />}
          {thinkingOn && <Brain size={13} strokeWidth={1.75} />}
        </span>}
        <ChevronDown size={14} strokeWidth={1.5} className="text-fg-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="right-0 bottom-full mb-2 w-80 p-3">
        <div className="mb-3 flex h-6 items-center gap-2">
          <span className="text-ui text-fg-secondary">{tr("session.Composer.message119")}</span>
          <span key={effort ?? ''} className={cn('text-ui font-semibold text-fg', top && 'effort-max')} style={accentStyle}>
            {effortLabel(effort)}
          </span>
          <span className="flex-1" />
          <IconButton
            icon={RotateCcw}
            label={tr("session.ComposerMenus.message125", { p0: EFFORT_LABEL[DEFAULT_EFFORT] })}
            size={24}
            iconSize={14}
            disabled={effort === DEFAULT_EFFORT}
            className="-mr-1 disabled:opacity-40"
            onClick={() => live.setEffort(DEFAULT_EFFORT)}
          />
        </div>
        <EffortSlider efforts={efforts} effort={effort} onChange={live.setEffort} accent={accent} />
        {hasSwitches && (
          <div className="mt-3 flex flex-col border-t border-line-subtle pt-1">
            {ultracodeSupported && (
              <SwitchRow
                icon={<Sparkles size={14} strokeWidth={1.75} className={ultracode ? 'text-ultracode' : 'text-fg-muted'} />}
                label="Ultracode"
                tone="ultracode"
                desc={ultraUnavailable ? tr("session.ComposerMenus.message126") : tr("session.ComposerMenus.message127")}
                checked={ultracode}
                disabled={ultraUnavailable && !ultracode}
                onChange={live.setUltracode}
              />
            )}
            {live.fastSupported && (
              <SwitchRow
                icon={<Zap size={14} strokeWidth={1.75} className={live.fast ? 'text-accent' : 'text-fg-muted'} />}
                label={tr("session.ComposerMenus.message128")}
                desc={fastUnavailable ? tr("session.ComposerMenus.message129", { p0: live.fastBlocked ?? '原因未知' }) : tr("session.ComposerMenus.message131")}
                checked={live.fast}
                disabled={fastUnavailable && !live.fast}
                onChange={live.setFast}
              />
            )}
            {live.thinkingSupported && (
              <SwitchRow
                icon={<Brain size={14} strokeWidth={1.75} className={live.thinkingSummaries ? 'text-accent' : 'text-fg-muted'} />}
                label={tr("session.ComposerMenus.message132")}
                desc={tr("session.ComposerMenus.message133")}
                checked={live.thinkingSummaries}
                onChange={live.setThinkingSummaries}
              />
            )}
          </div>
        )}
      </Popover>
    </div>
  )
}

export function PermissionMenu({
  mode,
  modes,
  onSelect,
  engine,
}: {
  mode: PermissionMode
  modes: PermissionMode[]
  onSelect: (m: PermissionMode) => void
  engine?: 'claude' | 'codex'
}) {
  useI18n()
  const [open, setOpen] = useState(false)
  const Icon = PERMISSION_ICON[mode]
  return (
    <div className="relative">
      <button
        type="button"
        title={tr("session.ComposerMenus.message134", { p0: PERMISSION_INFO[mode].label })}
        aria-label={tr("session.ComposerMenus.message134", { p0: PERMISSION_INFO[mode].label })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'press no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-list hover:bg-hover',
          mode === 'full' ? 'text-warn' : 'text-fg-secondary hover:text-fg',
        )}
      >
        <Icon size={16} strokeWidth={1.5} />
        <span>{PERMISSION_INFO[mode].label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="bottom-full left-0 mb-2 w-72">
        <MenuTitle>{tr("session.Composer.message118")}</MenuTitle>
        {(['ask', 'edits', 'plan', 'full'] as const).map((m) => {
          const MIcon = PERMISSION_ICON[m]
          const supported = modes.includes(m)
          return (
            <MenuRow
              key={m}
              selected={m === mode}
              disabled={!supported}
              icon={<MIcon size={16} strokeWidth={1.5} className={m === 'full' ? 'text-warn' : 'text-fg-muted'} />}
              title={PERMISSION_INFO[m].label}
              hint={supported ? engine === 'codex' && m !== 'full' ? tr(`codex.permission.${m}`) : PERMISSION_INFO[m].hint : tr("session.ComposerMenus.message135")}
              onClick={() => {
                onSelect(m)
                setOpen(false)
              }}
            />
          )
        })}
      </Popover>
    </div>
  )
}
