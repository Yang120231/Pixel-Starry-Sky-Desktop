import { Plus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useComingSoon } from '@/ui'
import { useSidebarData } from '@/features/engine'
import { useSessionCards } from '@/features/board/useSessionCards'
import { paneActions } from '@/features/panes/store'
import { ProjectTree } from '@/features/sidebar/ProjectTree'
import { Section } from '../../shell/Section'
import { ConversationRow } from '../../shell/ConversationRow'
import { PanelHeader } from '../../shell/PanelHeader'
import { newChatInProject, useCodingSessionId, useCodingWorkspace } from '../../workspace'
import { useProjectConversations } from '../../sessions'
import { conversationsBadge } from './badgeModel'

/** 左栏「对话」：新对话 + 这个项目的对话 + 所有项目 */
export function ConversationsView({ visible }: { visible: boolean }) {
  useI18n()
  const { projectId } = useCodingWorkspace()
  const sessionId = useCodingSessionId()
  const entries = useProjectConversations(projectId)
  const projects = useSidebarData().projects
  const comingSoon = useComingSoon()
  const onNew = (): void => {
    if (!newChatInProject(projectId)) comingSoon()
  }
  const onSelect = (id: string): void => paneActions.open(id)
  return (
    <div data-coding-conversations aria-hidden={!visible || undefined} className="flex h-full min-h-0 min-w-0 flex-col">
      <PanelHeader title={tr('coding.nav.conversations.title')} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="px-2 pb-1">
          <button
            type="button"
            onClick={onNew}
            className="press no-drag flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-ui text-fg hover:bg-hover"
          >
            <Plus size={16} strokeWidth={1.5} className="shrink-0" />
            <span className="min-w-0 truncate">{tr('coding.nav.conversations.new')}</span>
          </button>
        </div>
        <Section id="coding.conversations.project" title={tr('coding.nav.conversations.thisProject')}>
          <div className="flex flex-col gap-px px-2">
            {entries.length === 0 ? (
              <div className="px-2 py-1 text-meta text-fg-faint">{tr('coding.nav.conversations.empty')}</div>
            ) : (
              entries.map(entry => (
                <ConversationRow key={entry.id} entry={entry} active={entry.id === sessionId} onSelect={onSelect} />
              ))
            )}
          </div>
        </Section>
        <Section id="coding.conversations.all" title={tr('coding.nav.conversations.allProjects')}>
          <div className="flex flex-col gap-px px-2">
            <ProjectTree projects={projects} selectedSessionId={sessionId} onSelectSession={onSelect} />
          </div>
        </Section>
      </div>
    </div>
  )
}

/** 工具条「对话」图标上的小点：当前项目里有新回复，或有会话在等你 */
export function useConversationsBadge(): boolean {
  const { projectId } = useCodingWorkspace()
  const entries = useProjectConversations(projectId)
  const cards = useSessionCards()
  return conversationsBadge(entries, cards, projectId)
}
