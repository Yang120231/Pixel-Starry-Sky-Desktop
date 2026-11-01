import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useMemo, useState } from 'react'
import type { Session } from '@/data'
import { useSessionCards } from '@/features/board/useSessionCards'
import { cardsOf, lanesOf } from './runFilter'
import { SessionItem } from './SessionItem'
import { ArchivedRows, MoreRow } from './ProjectTree'
import { SHOWN_SESSIONS, visibleSessions } from './projectTreeModel'

/** 侧栏「对话」分组：不用项目的对话，和项目下面的对话一样先列 5 个，其余收进「还有 N 个对话」，归档的收进「已归档 N 个」 */
export function ChatList({
  chats,
  archived,
  selectedSessionId,
  onSelectSession,
  filtering = false,
}: {
  chats: Session[]
  /** 归档了的对话；按状态筛选时传空 */
  archived: Session[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  /** 侧栏按状态筛选时：全部列出，右边写原因 */
  filtering?: boolean
}) {
  useI18n()
  const cards = useSessionCards()
  const lanes = useMemo(() => lanesOf(cards), [cards])
  const cardById = useMemo(() => cardsOf(cards), [cards])
  const [showAll, setShowAll] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archivedShown, setArchivedShown] = useState<number>()
  const { shown, hidden } = visibleSessions(chats, { all: filtering || showAll, selected: selectedSessionId, lanes })
  return (
    <div data-chat-sessions className="flex flex-col gap-px">
      {shown.map(s => (
        <SessionItem
          key={s.id}
          session={s}
          selected={s.id === selectedSessionId}
          onSelect={onSelectSession}
          lane={lanes.get(s.id)}
          card={cardById.get(s.id)}
          reason={filtering}
          flipKey={`chat/${s.id}`}
        />
      ))}
      {!filtering && (hidden > 0 || (showAll && chats.length > SHOWN_SESSIONS)) && (
        <MoreRow
          label={hidden > 0 ? tr('sidebar.tree.more', { count: hidden }) : tr('sidebar.tree.less')}
          open={!hidden}
          onClick={() => setShowAll(!showAll)}
        />
      )}
      <ArchivedRows
        archived={archived}
        selectedSessionId={selectedSessionId}
        onSelectSession={onSelectSession}
        open={archivedOpen}
        onToggle={() => setArchivedOpen(!archivedOpen)}
        limit={archivedShown}
        onMore={setArchivedShown}
      />
    </div>
  )
}
