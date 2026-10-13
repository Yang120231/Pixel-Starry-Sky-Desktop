import { useEffect, useState } from 'react'
import { Copy, MessageSquareText, MoreHorizontal, PanelRightClose, Plus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
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

  // 没有对话标签时补一个新对话；放在 effect 里，渲染时先空白
  useEffect(() => {
    if (chatTab === null && visible) paneActions.open(null)
  }, [chatTab, visible])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
        <MessageSquareText size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
        <ConversationSwitcher sessionId={sessionId} />
        <div className="flex-1" />
        <div className="no-drag flex shrink-0 items-center gap-0.5">
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
            <Popover open={menu} onClose={() => setMenu(false)} className="top-full right-0 mt-1">
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
              onOpenSession={id => paneActions.replace(chatTab, id)}
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
