import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useMemo, useState } from 'react'
import type { Session } from '@/data'
import { useSessionCards } from '@/features/board/useSessionCards'
import { cardsOf, lanesOf } from './runFilter'
import { SessionItem } from './SessionItem'
import { MoreRow } from './ProjectTree'
import { SHOWN_SESSIONS, visibleSessions } from './projectTreeModel'

/** 侧栏「对话」分组：不用项目的对话，和项目下面的对话一样先列 5 个，其余收进「还有 N 个对话」 */
export function ChatList({
  chats,
  selectedSessionId,
  onSelectSession,
  filtering = false,
}: {
  chats: Session[]
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
    </div>
  )
}
