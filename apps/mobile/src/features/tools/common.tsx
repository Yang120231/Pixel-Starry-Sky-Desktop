// 工具页的公共部分（docs/mobile-remote.md §18.4）：页头（返回 / 菜单 / 关闭、刷新）、加载和出错。
import type { ReactNode } from 'react'
import { RefreshCw, X } from 'lucide-react'
import type { ProjectRecord } from '@pixelsky/protocol'
import { L } from '@/i18n'
import { Banner, IconButton, Screen, Spinner, cn } from '@/ui'

export interface ToolProps {
  deviceId: string
  project: ProjectRecord
  /** 工具里的下一级（文件路径、要看的改动…）；null 是工具首页。由 App 放进浏览历史，返回键能回来 */
  sub: string | null
  onSub(sub: string): void
  /** 从下一级回来 */
  onBack(): void
  /** 首页左上角（窄屏的抽屉按钮） */
  leading?: ReactNode
  /** 在右边一栏打开时的关闭 */
  onClose?: () => void
  canAct: boolean
  onOpenSession(sessionId: string): void
  /** 在项目里新建会话，输入框里先放好 text */
  onNewSession(projectId: string, text: string): void
}

export function ToolFrame({
  tool,
  title,
  subtitle,
  loading,
  onRefresh,
  actions,
  footer,
  scroll = true,
  children,
}: {
  tool: ToolProps
  title: ReactNode
  subtitle?: ReactNode
  loading?: boolean
  onRefresh?: () => void
  actions?: ReactNode
  footer?: ReactNode
  scroll?: boolean
  children: ReactNode
}) {
  const top = tool.sub === null
  return (
    <Screen
      title={title}
      subtitle={subtitle ?? tool.project.name}
      onBack={top ? undefined : tool.onBack}
      leading={top ? tool.leading : undefined}
      scroll={scroll}
      footer={footer}
      actions={
        <>
          {actions}
          {onRefresh && (
            <button
              type="button"
              aria-label={L('刷新', 'Refresh')}
              disabled={loading}
              onClick={onRefresh}
              className="flex size-11 items-center justify-center rounded-full text-fg-secondary active:bg-hover"
            >
              {loading ? <Spinner size={16} /> : <RefreshCw size={19} strokeWidth={1.75} />}
            </button>
          )}
          {top && tool.onClose && <IconButton label={L('关闭', 'Close')} icon={X} onClick={tool.onClose} />}
        </>
      }
    >
      {children}
    </Screen>
  )
}

/** 第一次加载：转圈；出错：提示 */
export function Loading({ error, className }: { error?: string | null; className?: string }) {
  if (error) return <Banner tone="danger">{error}</Banner>
  return (
    <div className={cn('flex items-center justify-center gap-2 py-16 text-meta text-fg-muted', className)}>
      <Spinner /> {L('正在读取…', 'Loading…')}
    </div>
  )
}

/** 路径拆成文件名和所在目录 */
export function splitPath(path: string): { name: string; dir: string } {
  const clean = path.replace(/[\\/]+$/, '')
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return { name: clean.slice(i + 1), dir: i > 0 ? clean.slice(0, i) : '' }
}

/** 文件一行：名字、目录（小字）、右边的东西 */
export function PathRow({
  path,
  icon,
  badge,
  trailing,
  onClick,
  first,
}: {
  path: string
  icon?: ReactNode
  badge?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  first?: boolean
}) {
  const { name, dir } = splitPath(path)
  return (
    <div className={cn('flex items-center', !first && 'border-t border-line-subtle')}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="flex min-h-13 min-w-0 flex-1 items-center gap-2.5 py-2 pl-4 text-left active:bg-hover"
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-ui">{name}</span>
            {badge}
          </span>
          {dir && <span className="truncate font-mono text-label text-fg-faint">{dir}</span>}
        </span>
      </button>
      <span className="flex shrink-0 items-center pr-2">{trailing}</span>
    </div>
  )
}
