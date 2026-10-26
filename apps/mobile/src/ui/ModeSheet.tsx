// 改模式的面板（docs/mobile-remote.md §21.5）：几组单选（权限模式、模型、强度）加几个开关。
// 只管画，选项和规则由调用方算好传进来（data/mode.ts）；窄屏从底部弹出，宽屏是右侧面板（Sheet）。
// iOS 样子：分组小标题、整行可点的选项（选中的右边打勾）、行与行之间一条细线、开关在行右边；选项少的一组（强度）可以画成分段按钮。
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Sheet } from './sheet'
import { Segmented, Spinner, cn } from './index'

export interface ModeChoice {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

export interface ModeGroup {
  key: string
  title: string
  options: ModeChoice[]
  value: string
  onPick(value: string): void
  /** 选项不多、没有说明时画成一排分段按钮（强度）；条件不满足仍是一行一项 */
  segmented?: boolean
}

export interface ModeToggle {
  key: string
  label: string
  hint?: string
  /** 提示是开不了 / 冷却的原因：用警示色 */
  warn?: boolean
  /** 名字前的小图标 */
  icon?: ReactNode
  /** 这一项拨不了（引擎、账号不支持） */
  disabled?: boolean
  value: boolean
  onChange(value: boolean): void
}

export function ModeSheet({
  title,
  groups,
  toggles = [],
  note,
  error,
  busy,
  readOnly,
  onClose,
}: {
  title: ReactNode
  groups: ModeGroup[]
  toggles?: ModeToggle[]
  /** 底部一行说明（「下一轮生效」「会影响费用」） */
  note?: string
  error?: string | null
  /** 正在改：选项先不让点 */
  busy?: boolean
  /** 只看档的手机：只显示当前值 */
  readOnly?: boolean
  onClose(): void
}) {
  const locked = busy || readOnly
  return (
    <Sheet
      title={
        <span className="inline-flex items-center gap-2">
          {title}
          {busy && <Spinner size={14} />}
        </span>
      }
      onClose={onClose}
      footer={
        (note || error) && (
          <div className="flex flex-col gap-1 px-5 py-3 text-label">
            {error && <span className="text-danger">{error}</span>}
            {note && <span className="text-fg-muted">{note}</span>}
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5 px-5 pt-1 pb-3">
        {groups.map(g => {
          const seg = g.segmented && g.options.length <= 5 && !g.options.some(o => o.hint || o.disabled)
          return (
            <section key={g.key} className="flex flex-col">
              <h3 className="pb-1.5 text-meta font-semibold text-fg-muted">{g.title}</h3>
              {seg ? (
                <div className={cn(locked && 'pointer-events-none opacity-50')}>
                  <Segmented
                    options={g.options.map(o => ({ value: o.value, label: o.label }))}
                    value={g.value}
                    onChange={v => !locked && v !== g.value && g.onPick(v)}
                  />
                </div>
              ) : (
                g.options.map((o, i) => {
                  const selected = o.value === g.value
                  return (
                    <button
                      key={o.value || '_default'}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={o.disabled || (locked && !selected)}
                      onClick={() => !selected && g.onPick(o.value)}
                      className={cn(
                        'flex min-h-13 w-full items-center gap-3 py-2 text-left active:bg-hover disabled:active:bg-transparent',
                        i > 0 && 'border-t border-line-subtle',
                        (o.disabled || (locked && !selected)) && 'opacity-50',
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn('truncate text-ui', selected && 'font-medium')}>{o.label}</span>
                        {o.hint && <span className="line-clamp-2 text-label text-fg-muted">{o.hint}</span>}
                      </span>
                      {selected && <Check size={20} className="shrink-0 text-accent-fg" />}
                    </button>
                  )
                })
              )}
            </section>
          )
        })}
        {toggles.length > 0 && (
          <section className="flex flex-col">
            {toggles.map((t, i) => (
              <label
                key={t.key}
                className={cn(
                  'flex min-h-13 items-center gap-3 py-2',
                  i > 0 && 'border-t border-line-subtle',
                  (locked || t.disabled) && 'opacity-50',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="inline-flex items-center gap-1.5 text-ui">
                    {t.icon}
                    {t.label}
                  </span>
                  {t.hint && <span className={cn('text-label', t.warn ? 'text-warn' : 'text-fg-muted')}>{t.hint}</span>}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={t.value}
                  disabled={locked || t.disabled}
                  onChange={e => t.onChange(e.target.checked)}
                  className="peer sr-only"
                />
                {/* iOS 开关：滑块用伪元素画，选中时底色变绿、滑块右移；键盘聚焦时画一圈 */}
                <span
                  aria-hidden
                  className="relative h-8 w-13 shrink-0 rounded-full bg-line-strong transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-7 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-success peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                />
              </label>
            ))}
          </section>
        )}
      </div>
    </Sheet>
  )
}
