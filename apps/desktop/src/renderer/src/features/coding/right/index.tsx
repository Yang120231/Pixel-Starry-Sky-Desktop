import { useEffect, useState } from 'react'
import { Bell, Box, Copy, Globe, ListTodo, MessageSquareText, Package, type LucideIcon } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import type { WorkspaceRef } from '../../../../../shared/types/workspace'
import { BrowserTab } from '@/features/panel/BrowserTab'
import { TasksPanel } from '@/features/panel/TasksPanel'
import { EnvironmentPanel, OPEN_BROWSER } from '@/features/panel/EnvironmentPanel'
import { CopiesPanel } from '@/features/panel/CopiesPanel'
import { ArtifactsPanel } from '@/features/panel/artifacts/ArtifactsPanel'
import { TaskInbox } from '@/features/panel/inbox/TaskInbox'
import { PanelHeader } from '../shell/PanelHeader'
import type { RightView } from '../types'
import { ChatView } from './ChatView'
import { RIGHT_VIEW_ORDER, resolveRightView, rightViewMeta, type RightViewIcon } from './viewModel'

const ICONS: Record<RightViewIcon, LucideIcon> = {
  chat: MessageSquareText,
  browser: Globe,
  artifacts: Package,
  notifications: Bell,
  tasks: ListTodo,
  sandbox: Box,
  copies: Copy,
}

interface BrowserRequest {
  ref: WorkspaceRef
  url: string
  seq: number
}

/** 右栏：按 view 切换；每个视图第一次打开后保持挂载，用 hidden + inert 切换 */
export function RightArea({ visible, view }: { visible: boolean; view: RightView }) {
  const { t } = useI18n()
  const current = resolveRightView(view)
  const [visited, setVisited] = useState<ReadonlySet<RightView>>(() => new Set([current]))
  const [request, setRequest] = useState<BrowserRequest | null>(null)

  useEffect(() => {
    setVisited(old => (old.has(current) ? old : new Set([...old, current])))
  }, [current])

  useEffect(() => {
    const onBrowser = (e: Event) => {
      const detail = (e as CustomEvent<{ ref: WorkspaceRef; url: string }>).detail
      if (detail) setRequest({ ...detail, seq: Date.now() })
    }
    window.addEventListener(OPEN_BROWSER, onBrowser)
    return () => window.removeEventListener(OPEN_BROWSER, onBrowser)
  }, [])

  return (
    <div data-coding-right-area className="flex min-h-0 min-w-0 flex-1 flex-col">
      {RIGHT_VIEW_ORDER.map(kind => {
        const active = kind === current
        if (!active && !visited.has(kind)) return null
        const meta = rightViewMeta(kind)
        const Icon = ICONS[meta.icon]
        return (
          <div
            key={kind}
            data-coding-right-view={kind}
            className={active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
            inert={!active}
          >
            {kind === 'chat' ? (
              <ChatView visible={visible && active} />
            ) : (
              <>
                <PanelHeader
                  title={
                    <span className="flex items-center gap-1.5">
                      <Icon size={14} strokeWidth={1.5} className="shrink-0" />
                      {t(meta.titleKey)}
                    </span>
                  }
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {kind === 'browser' ? (
                    <BrowserTab requested={request} />
                  ) : kind === 'artifacts' ? (
                    <ArtifactsPanel active={visible && active} />
                  ) : kind === 'notifications' ? (
                    <TaskInbox />
                  ) : kind === 'tasks' ? (
                    <TasksPanel />
                  ) : kind === 'sandbox' ? (
                    <EnvironmentPanel />
                  ) : (
                    <CopiesPanel />
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
