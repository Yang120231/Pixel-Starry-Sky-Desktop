import { useState } from 'react'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { useSessionTitle } from '@/features/engine'
import { paneActions } from '@/features/panes/store'
import { useOpenSearch } from '@/features/search/SearchProvider'
import { Popover, PopoverItem } from '@/ui/Popover'
import { useComingSoon } from '@/ui/ComingSoon'
import { ConversationRow } from '../shell/ConversationRow'
import { useProjectConversations } from '../sessions'
import { newChatInProject, useCodingWorkspace } from '../workspace'

/** 右栏标题行左边：当前对话标题 + 下拉，列出当前项目的对话 */
export function ConversationSwitcher({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const title = useSessionTitle(sessionId)
  const { projectId } = useCodingWorkspace()
  const entries = useProjectConversations(projectId)
  const openSearch = useOpenSearch()
  const soon = useComingSoon()
  const close = () => setOpen(false)
  const newChat = () => {
    close()
    if (!newChatInProject(projectId)) soon(t('coding.right.chat.newChatSoon'))
  }
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('coding.right.chat.switch')}
        title={title}
        onClick={() => setOpen(v => !v)}
        className="press no-drag flex h-7 max-w-full min-w-0 items-center gap-1 rounded-md px-2 text-ui font-medium text-fg hover:bg-hover"
      >
        <span className="min-w-0 truncate">{title}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      </button>
      <Popover open={open} onClose={close} className="w-72">
        <div className="max-h-72 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="px-2 py-2 text-ui text-fg-faint">{t('coding.right.chat.empty')}</div>
          ) : (
            entries.map(entry => (
              <ConversationRow
                key={entry.id}
                entry={entry}
                active={entry.id === sessionId}
                onSelect={id => {
                  close()
                  paneActions.open(id)
                }}
              />
            ))
          )}
        </div>
        <div className="my-1 h-px bg-line-card" />
        <PopoverItem icon={<Plus size={16} strokeWidth={1.5} className="shrink-0" />} onClick={newChat}>
          {t('coding.right.chat.newChat')}
        </PopoverItem>
        <PopoverItem
          icon={<Search size={16} strokeWidth={1.5} className="shrink-0" />}
          onClick={() => {
            close()
            requestAnimationFrame(() => openSearch())
          }}
        >
          {t('coding.right.chat.searchAll')}
        </PopoverItem>
      </Popover>
    </div>
  )
}
