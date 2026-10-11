// 手机端的通用小组件。只用设计变量（styles/tokens.css），不导入 features / data / connection。
// packages/ui 抽出后，和桌面端相同的部分改用那里的。
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

export const cn = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg shadow-sm',
  secondary: 'border border-line-strong bg-surface text-fg',
  ghost: 'text-fg-secondary',
  danger: 'border border-line-strong bg-surface text-danger',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-opacity active:opacity-70 disabled:pointer-events-none disabled:border-transparent disabled:bg-disabled disabled:text-disabled-fg disabled:shadow-none',
        size === 'md' ? 'min-h-12 rounded-xl px-5 text-ui' : 'min-h-9 rounded-lg px-3 text-meta',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  icon: Icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...rest}
      className={cn(
        'flex size-11 items-center justify-center rounded-full text-fg-secondary active:bg-hover',
        className,
      )}
    >
      <Icon size={22} strokeWidth={1.75} />
    </button>
  )
}

/**
 * 一页：顶栏（可选返回、操作）+ 内容 + 可选底栏；顶部和底部留出刘海 / 手势条的安全区。
 * large：一级页面用大标题（标题在内容区顶部，跟着滚动）。scroll=false 时内容自己处理滚动（会话页）。
 */
export function Screen({
  title,
  subtitle,
  onBack,
  actions,
  children,
  footer,
  large,
  scroll = true,
}: {
  title: ReactNode
  subtitle?: ReactNode
  onBack?: () => void
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  large?: boolean
  scroll?: boolean
}) {
  return (
    <div className="flex h-dvh flex-col bg-app text-fg">
      <header
        className={cn(
          'flex shrink-0 items-center gap-1 bg-app/95 px-1 pt-[env(safe-area-inset-top)] backdrop-blur',
          !large && 'border-b border-line-subtle',
        )}
      >
        {onBack ? <IconButton label="返回" icon={ChevronLeft} onClick={onBack} /> : <span className="w-3" />}
        <div className="min-w-0 flex-1 py-2">
          {!large && <div className="truncate text-section font-semibold">{title}</div>}
          {!large && subtitle && <div className="truncate text-meta text-fg-muted">{subtitle}</div>}
        </div>
        {actions}
      </header>
      <main className={cn('min-h-0 flex-1', scroll ? 'overflow-y-auto' : 'flex flex-col overflow-hidden')}>
        {large && (
          <div className="px-4 pt-1 pb-3">
            <h1 className="text-title">{title}</h1>
            {subtitle && <div className="mt-1 text-meta text-fg-muted">{subtitle}</div>}
          </div>
        )}
        {children}
      </main>
      {footer && <div className="shrink-0 bg-panel pb-[env(safe-area-inset-bottom)]">{footer}</div>}
    </div>
  )
}

/** 底部标签栏（一级页面） */
export function TabBar({
  items,
}: {
  items: { key: string; label: string; icon: LucideIcon; active: boolean; badge?: number; onClick(): void }[]
}) {
  return (
    <nav className="flex border-t border-line-subtle">
      {items.map(({ key, label, icon: Icon, active, badge, onClick }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5',
            active ? 'text-fg' : 'text-fg-faint',
          )}
        >
          <Icon size={22} strokeWidth={active ? 2 : 1.75} />
          <span className="text-label">{label}</span>
          {!!badge && (
            <span className="absolute top-1.5 left-1/2 ml-2 min-w-4.5 rounded-full bg-danger px-1 text-center text-label leading-4.5 text-accent-on">
              {badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}

export function Dot({ tone, pulse }: { tone: 'online' | 'danger' | 'warn' | 'muted'; pulse?: boolean }) {
  const color = { online: 'bg-online', danger: 'bg-danger', warn: 'bg-warn', muted: 'bg-fg-faint' }[tone]
  return (
    <span aria-hidden className="relative inline-flex size-2 shrink-0">
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', color)} />}
      <span className={cn('relative inline-block size-2 rounded-full', color)} />
    </span>
  )
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  )
}

/** 三个跳动的点：正在思考 */
export function Typing() {
  return (
    <span aria-label="正在处理" className="inline-flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="typing-dot size-1.5 rounded-full bg-fg-faint"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  )
}

/** 小标签：等你处理、运行中、排队数 */
export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'danger' | 'accent' | 'muted' | 'warn'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium',
        tone === 'danger' && 'bg-danger text-accent-on',
        tone === 'accent' && 'bg-accent-soft text-accent-fg',
        tone === 'warn' && 'bg-subtle text-warn',
        tone === 'muted' && 'bg-subtle text-fg-muted',
      )}
    >
      {children}
    </span>
  )
}

/** 分组：小标题 + 圆角卡片（像系统设置的分组列表） */
export function Section({
  title,
  trailing,
  children,
  className,
}: {
  title?: ReactNode
  trailing?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('px-4', className)}>
      {(title || trailing) && (
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="flex items-center gap-1.5 text-meta font-medium text-fg-muted">{title}</h2>
          {trailing}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface">{children}</div>
    </section>
  )
}

/** 分组里的一行 */
export function Row({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  chevron,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  chevron?: boolean
  className?: string
}) {
  const body = (
    <>
      {icon && <span className="flex shrink-0 text-fg-muted">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="min-w-0 text-ui text-fg">{title}</span>
        {subtitle && <span className="min-w-0 truncate text-meta text-fg-muted">{subtitle}</span>}
      </span>
      {trailing}
      {chevron && <ChevronRight size={18} className="shrink-0 text-fg-faint" />}
    </>
  )
  const base = cn(
    'flex min-h-14 w-full items-center gap-3 px-4 py-3 [&+&]:border-t [&+&]:border-line-subtle',
    className,
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(base, 'active:bg-hover')}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  )
}

/** 顶部提示条：连接状态、错误 */
export function Banner({
  tone = 'muted',
  icon,
  children,
  action,
}: {
  tone?: 'muted' | 'danger' | 'warn'
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-4 mb-3 flex items-center gap-3 rounded-xl px-3.5 py-3 text-meta',
        tone === 'danger'
          ? 'bg-subtle text-danger'
          : tone === 'warn'
            ? 'bg-subtle text-warn'
            : 'bg-subtle text-fg-secondary',
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** 空状态：图标 + 说明 + 可选按钮 */
export function Empty({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-subtle text-fg-muted">
        <Icon size={26} strokeWidth={1.5} />
      </span>
      <div className="text-section font-semibold">{title}</div>
      {body && <div className="text-meta text-fg-muted">{body}</div>}
      {action}
    </div>
  )
}

/** 分段选择 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange(value: T): void
}) {
  return (
    <div role="radiogroup" className="flex rounded-xl bg-subtle p-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-10 flex-1 rounded-lg text-ui',
            o.value === value ? 'bg-surface font-medium text-fg shadow-sm' : 'text-fg-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** unified diff：+ / − 行着色，@@ 行变淡；外面套圆角框 */
export function DiffView({ diff, ref }: { diff: string; ref?: Ref<HTMLPreElement> }) {
  if (!diff) return <p className="px-3 py-2 text-meta text-fg-muted">没有改动内容</p>
  return (
    <pre ref={ref} className="overflow-x-auto py-1.5 font-mono text-label leading-relaxed">
      {diff.split('\n').map((line, i) => (
        <div
          key={i}
          className={cn(
            'min-w-max px-3 whitespace-pre',
            line.startsWith('+') && 'bg-accent-soft text-success',
            line.startsWith('-') && 'bg-subtle text-danger',
            line.startsWith('@@') && 'py-0.5 text-fg-faint',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}
