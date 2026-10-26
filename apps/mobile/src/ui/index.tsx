// 手机端的通用小组件。只用设计变量（styles/tokens.css），不导入 features / data / connection。
// packages/ui 抽出后，和桌面端相同的部分改用那里的。
import { useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { ChevronLeft, ChevronRight, Menu, X, type LucideIcon } from 'lucide-react'
import { L } from '@/i18n'

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

/** round：顶栏的浮动圆钮（白底细边框、40px，§26）；其余是没有底的 44px 图标键 */
export const ROUND_BUTTON = 'size-10 border border-line-subtle bg-surface text-fg shadow-sm disabled:opacity-40'

export function IconButton({
  label,
  icon: Icon,
  round,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; round?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...rest}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full active:bg-hover',
        round ? ROUND_BUTTON : 'size-11 text-fg-secondary',
        className,
      )}
    >
      <Icon size={round ? 20 : 22} strokeWidth={1.75} />
    </button>
  )
}

/** 宽屏（平板、电脑浏览器）：抽屉常驻左边（docs/mobile-remote.md §18.3） */
export const WIDE = '(min-width: 900px)'
/** 再宽：工具面板放在最右边一栏 */
export const WIDER = '(min-width: 1280px)'
/** 有实体键盘、精确指针（电脑浏览器）：回车发送 */
export const FINE_POINTER = '(hover: hover) and (pointer: fine)'

/** 媒体查询（窗口大小变了跟着变） */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    listener => {
      const m = matchMedia(query)
      m.addEventListener('change', listener)
      return () => m.removeEventListener('change', listener)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

/** 左上角打开抽屉的按钮（窄屏才有），角标是等你处理的数量 */
export function MenuButton({ badge, onClick }: { badge?: number; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={
        badge ? L(`打开菜单（${badge} 个等你处理）`, `Open menu (${badge} need you)`) : L('打开菜单', 'Open menu')
      }
      onClick={onClick}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-fg-secondary active:bg-hover min-[900px]:hidden"
    >
      <Menu size={22} strokeWidth={1.75} />
      {!!badge && (
        <span className="absolute top-1 right-0.5 min-w-4.5 rounded-full bg-danger px-1 text-center text-label leading-4.5 text-accent-on">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/**
 * 一页（iOS 样子，§26）：顶栏（返回或菜单圆钮、居中的标题、操作）+ 内容 + 可选底栏；顶部和底部留出刘海 / 手势条的安全区。
 * 整页 bg-workbench；顶栏实底盖住刘海区，返回键和 leading 里的按钮都是带边框的浮动圆钮（ROUND_BUTTON），底边一小段渐隐。
 * large：一级页面用大标题（标题在内容区顶部，跟着滚动）。scroll=false 时内容自己处理滚动（会话页）。
 * leading：没有返回按钮时放在左上角的（抽屉按钮）。
 * floating（会话页）：标题 + 副标题竖排居中，副标题可以带状态点（不再单行截断）。
 */
export function Screen({
  title,
  subtitle,
  onBack,
  close,
  leading,
  actions,
  children,
  footer,
  large,
  scroll = true,
  floating,
  footerBg = 'bg-workbench',
}: {
  title: ReactNode
  subtitle?: ReactNode
  onBack?: () => void
  /** 返回键画成 ×：整页弹出、关掉就回去的流程（添加电脑、扫码、配对） */
  close?: boolean
  leading?: ReactNode
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  large?: boolean
  scroll?: boolean
  /** 会话页：subtitle 自己排版（可以带状态点），不再是单行截断 */
  floating?: boolean
  /** 底栏背景类，默认和整页一样的 bg-workbench */
  footerBg?: string
}) {
  return (
    <div className="flex h-app min-w-0 flex-1 flex-col bg-workbench text-fg">
      <header className="relative z-10 flex shrink-0 items-center gap-2.5 bg-workbench px-3.5 pt-[max(env(safe-area-inset-top),8px)] pb-1.5">
        {onBack ? (
          <IconButton
            round
            label={close ? L('关闭', 'Close') : L('返回', 'Back')}
            icon={close ? X : ChevronLeft}
            onClick={onBack}
          />
        ) : (
          // contents：不多一层盒子；shortcut: 用子选择器给 MenuButton 套圆钮样子，MenuButton 多了用法再改成 prop
          <div className="contents [&>button]:size-10 [&>button]:border [&>button]:border-line-subtle [&>button]:bg-surface [&>button]:text-fg [&>button]:shadow-sm">
            {leading ?? <span className="w-10 shrink-0" />}
          </div>
        )}
        {/* 宽屏抽屉常驻、菜单键藏起来：占一个圆钮的位置，标题还在中间 */}
        {!onBack && leading && <span className="hidden w-10 shrink-0 min-[900px]:block" />}
        <div className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center text-center">
          {!large && <div className="max-w-full truncate text-ui font-semibold">{title}</div>}
          {!large &&
            subtitle &&
            (floating ? (
              <div className="flex max-w-full items-center justify-center gap-1.5 text-meta text-fg-muted">
                {subtitle}
              </div>
            ) : (
              <div className="max-w-full truncate text-meta text-fg-muted">{subtitle}</div>
            ))}
        </div>
        {actions ?? <span className="w-10 shrink-0" />}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-full h-3.5 bg-linear-to-b from-workbench to-transparent"
        />
      </header>
      <main className={cn('min-h-0 flex-1', scroll ? 'overflow-y-auto' : 'flex flex-col overflow-hidden')}>
        {large && (
          <div className="px-5 pt-1 pb-3">
            <h1 className="text-title font-bold">{title}</h1>
            {subtitle && <div className="mt-1 text-meta text-fg-muted">{subtitle}</div>}
          </div>
        )}
        {children}
      </main>
      {footer && <div className={cn('shrink-0 pb-[env(safe-area-inset-bottom)]', footerBg)}>{footer}</div>}
    </div>
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
    <span aria-label={L('正在处理', 'Working')} className="inline-flex items-center gap-1">
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
      <div className="overflow-hidden rounded-2xl bg-subtle">{children}</div>
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
  const base = cn('flex min-h-12 w-full items-center gap-3 px-4 py-2.5 [&+&]:border-t [&+&]:border-line', className)
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(base, 'active:bg-hover')}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  )
}

/** 提示条：连接状态、错误。圆角 2xl；warn 是暖色淡底（图标橙色），其余保持浅灰底 */
export function Banner({
  tone = 'muted',
  icon,
  children,
  action,
}: {
  /** ok：恢复了（绿底，例如「已重新连上」） */
  tone?: 'muted' | 'danger' | 'warn' | 'ok'
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-4 mb-3 flex items-center gap-3 rounded-2xl px-3.5 py-3 text-meta',
        tone === 'danger'
          ? 'bg-subtle text-danger'
          : tone === 'warn'
            ? 'bg-warn/12 text-fg'
            : tone === 'ok'
              ? 'bg-accent-soft text-accent-fg'
              : 'bg-subtle text-fg-secondary',
      )}
    >
      {icon && <span className={cn('shrink-0', tone === 'warn' && 'text-warn')}>{icon}</span>}
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
            'min-h-9 flex-1 rounded-lg text-ui',
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
  if (!diff) return <p className="px-3 py-2 text-meta text-fg-muted">{L('没有改动内容', 'No changes')}</p>
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

/** 键帽（快捷键提示，只在有键盘的设备上显示） */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-b-2 border-line-strong bg-surface px-1 font-mono text-label leading-none text-fg-muted">
      {children}
    </kbd>
  )
}
