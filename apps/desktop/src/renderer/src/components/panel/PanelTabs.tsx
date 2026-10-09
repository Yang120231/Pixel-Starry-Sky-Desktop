import { Box, Copy, FileText, Globe, ListChecks, Maximize2, Minimize2, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { cn, IconButton } from '@/components/ui'
import type { PanelTab } from '@/mock/data'
import { useI18n } from '@/i18n/I18nProvider'

export const PANEL_TAB_ICONS: Record<PanelTab['kind'], LucideIcon> = {
  files: FileText,
  copies: Copy,
  sandbox: Box,
  browser: Globe,
  tasks: ListChecks,
}

interface PanelTabsProps {
  tabs: PanelTab[]
  activeId: string
  onSelect: (id: string) => void
  maximized?: boolean
}

/** 右侧面板标签栏位于全局顶栏下方，系统窗口按钮的留白统一由全局顶栏负责。 */
export function PanelTabs({ tabs, activeId, onSelect, maximized }: PanelTabsProps) {
  useI18n()
  const { text } = useI18n()
  const tabList = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const list = tabList.current
    const current = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!list || !current) return
    const reveal = (): void => current.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(list)
    observer.observe(current)
    return () => observer.disconnect()
  }, [activeId])

  return (
    <div data-panel-tabs className="flex h-10 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-b border-line-layout px-2">
      <div ref={tabList} role="tablist" aria-label={text('面板标签')} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
        {tabs.map((tab) => {
          const Icon = PANEL_TAB_ICONS[tab.kind]
          const active = tab.id === activeId
          const showLabel = active
          return (
            /* 选中的标签像分段控件里凸起的滑块：白底 + 细边框 + 极淡阴影 */
            <div
              key={tab.id}
              className={cn(
                'press no-drag flex h-[30px] shrink-0 items-center rounded-md border',
                active
                  ? 'border-line bg-surface text-fg shadow-sm'
                  : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg',
                tab.closable && 'pr-0.5',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={text(tab.label)}
                title={text(tab.label)}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  const idx = tabs.findIndex((t) => t.id === tab.id)
                  const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
                  if (!next) return
                  onSelect(next.id)
                  const list = e.currentTarget.closest('[role="tablist"]')
                  requestAnimationFrame(() =>
                    list?.querySelector<HTMLButtonElement>(`[data-tab-id="${next.id}"]`)?.focus(),
                  )
                }}
                data-tab-id={tab.id}
                className={cn(
                  'flex h-full cursor-default items-center gap-1.5 rounded-md text-list outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  showLabel ? 'px-2.5' : 'px-1.5',
                )}
              >
                <Icon size={15} strokeWidth={1.5} className="shrink-0" />
                {showLabel && <span>{text(tab.label)}</span>}
                {tab.count !== undefined && <span className="text-meta tabular-nums text-fg-faint">{tab.count}</span>}
              </button>

            </div>
          )
        })}
      </div>
      <div data-panel-actions className="flex shrink-0 items-center gap-1">
        <IconButton icon={maximized ? Minimize2 : Maximize2} label={text(maximized ? '还原面板' : '放大面板')} onClick={() => window.dispatchEvent(new CustomEvent('pixelsky:panel-maximize'))} />
      </div>
    </div>
  )
}
