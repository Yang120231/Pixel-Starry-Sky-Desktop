import { useEffect, useRef, useState } from 'react'
import { Copy, MessageSquareText, MoreHorizontal, PanelRightClose, Plus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { cn } from '@/ui'
import { ErrorBoundary } from '@/ui/ErrorBoundary'
import { IconButton } from '@/ui/IconButton'
import { Popover, PopoverItem } from '@/ui/Popover'
import { useComingSoon } from '@/ui/ComingSoon'
import { reportRendererError } from '@/features/logs/rendererErrors'
import { SessionView } from '@/features/session/SessionView'
import { useSessionTitle } from '@/features/engine'
import { paneActions } from '@/features/panes/store'
import { codingLayout } from '../layoutStore'
import { setAppMode } from '../mode'
import { chatDraftKey, newChatInProject, useCodingChatTab, useCodingSessionId, useCodingWorkspace } from '../workspace'
import { ConversationSwitcher } from './ConversationSwitcher'
import { forgetInput } from '@/features/logs/switchTiming'

const noop = () => {}

/** 右栏的对话：标题行（切换 / 新对话 / 更多 / 收起）+ 嵌入的会话本体 */
export function ChatView({ visible }: { visible: boolean }) {
  const { t } = useI18n()
  const chatTab = useCodingChatTab()
  const sessionId = useCodingSessionId()
  const title = useSessionTitle(sessionId)
  const { projectId } = useCodingWorkspace()
  const soon = useComingSoon()
  const [menu, setMenu] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  // 正在和对话打交道（刚打开、点了或聚焦在对话里）：左边亮一条主色竖线；点回编辑器等别处就熄掉
  const [engaged, setEngaged] = useState(visible)
  useEffect(() => {
    if (!visible) return
    setEngaged(true)
    const onTouch = (e: Event) => {
      const target = e.target as Element
      if (root.current?.contains(target)) setEngaged(true)
      // 弹出的菜单、对话框挂在 body 上：点它们不算离开对话，只有点到代码模式里的别处才熄
      else if (target.closest?.('[data-coding-layout]')) setEngaged(false)
    }
    document.addEventListener('pointerdown', onTouch, true)
    document.addEventListener('focusin', onTouch, true)
    return () => {
      document.removeEventListener('pointerdown', onTouch, true)
      document.removeEventListener('focusin', onTouch, true)
    }
  }, [visible])

  // 没有对话标签时补一个新对话；放在 effect 里，渲染时先空白
  useEffect(() => {
    if (chatTab === null && visible) paneActions.open(null)
  }, [chatTab, visible])

  return (
    // 对话用侧栏色（会话里用 bg-app 的地方跟着换），和编辑器拉开一档（docs/ui/coding-mode.md §2.3）
    <div
      ref={root}
      data-coding-chat
      data-engaged={engaged || undefined}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar [--bg-app:var(--bg-sidebar)]',
        "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:content-['']",
        engaged && 'before:bg-accent',
      )}
    >
      <div data-coding-chat-header className="flex h-9 shrink-0 items-center gap-1 border-b border-line-layout px-2">
        <MessageSquareText size={16} strokeWidth={1.5} className="shrink-0 text-accent-fg" />
        <ConversationSwitcher sessionId={sessionId} />
        <span
          aria-hidden
          data-coding-chat-badge
          className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] leading-4 font-medium text-accent-fg"
        >
          AI
        </span>
        <div className="flex-1" />
        <div data-coding-chat-actions className="no-drag flex shrink-0 items-center gap-0.5">
          <IconButton
            icon={Plus}
            label={t('coding.right.chat.newChat')}
            onClick={() => {
              if (!newChatInProject(projectId)) soon(t('coding.right.chat.newChatSoon'))
            }}
          />
          <div className="relative">
            <IconButton
              icon={MoreHorizontal}
              label={t('coding.right.chat.more')}
              active={menu}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(v => !v)}
            />
            <Popover open={menu} onClose={() => setMenu(false)} align="end">
              <PopoverItem
                icon={<Copy size={16} strokeWidth={1.5} className="shrink-0" />}
                disabled={!sessionId}
                onClick={() => {
                  setMenu(false)
                  if (sessionId) void navigator.clipboard.writeText(sessionId).catch(() => {})
                }}
              >
                {t('coding.right.chat.copyId')}
              </PopoverItem>
              <PopoverItem
                icon={<MessageSquareText size={16} strokeWidth={1.5} className="shrink-0" />}
                onClick={() => {
                  setMenu(false)
                  setAppMode('chat')
                }}
              >
                {t('coding.right.chat.switchToChat')}
              </PopoverItem>
            </Popover>
          </div>
          <IconButton
            icon={PanelRightClose}
            label={t('coding.right.chat.collapse')}
            onClick={() => codingLayout.setOpen('right', false)}
          />
        </div>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {chatTab !== null && (
          <ErrorBoundary
            resetKeys={[chatTab, sessionId]}
            label="coding-right-chat"
            onError={(error, componentStack, boundary) =>
              reportRendererError('react.boundary', error, { ...(componentStack ? { componentStack } : {}), boundary })
            }
          >
            <SessionView
              sessionId={sessionId}
              title={title}
              embedded
              draftKey={chatDraftKey(chatTab)}
              sidebarOpen={false}
              panelOpen={false}
              onToggleSidebar={noop}
              onTogglePanel={noop}
              onOpenSession={id => {
                forgetInput()
                paneActions.replace(chatTab, id)
              }}
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
