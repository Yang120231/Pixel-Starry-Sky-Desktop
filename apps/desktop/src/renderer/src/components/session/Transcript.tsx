import { useI18n } from '@/i18n/I18nProvider'
import { assistantReply, changedFiles, toolCalls, turnUsage } from '@/mock/data'
import { cn } from '@/components/ui'
import { ToolGroup } from './ToolGroup'
import { AssistantMessage } from './AssistantMessage'
import { ChangedFilesCard } from './ChangedFilesCard'
import { TurnStats } from './TurnStats'
import { useRef } from 'react'
import { useItemLocation } from '@/search/useItemLocation'

/** 滚动区铺满窗格；消息在居中的阅读列内左右对齐。 */
export function Transcript({ sessionId }: { sessionId: string | null }) {
  useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const highlight = useItemLocation(sessionId, scroller, true)
  return (
    <div ref={scroller} data-search-session={sessionId} className="conversation-scroller selectable min-h-0 flex-1 overflow-y-auto bg-app">
      <div data-conversation-stream className="conversation-inset conversation-reading flex flex-col pt-4 pb-6">
        {toolCalls.length > 0 && <div className="conversation-message"><ToolGroup calls={toolCalls} searchHighlight={highlight} /></div>}
        {toolCalls.length > 0 && (assistantReply || changedFiles) && <div className="conversation-message my-4 border-t border-line-subtle" />}
        <div data-search-item="demo-assistant" className={cn('conversation-message', highlight === 'demo-assistant' && 'search-hit')}><AssistantMessage /></div>
        <ChangedFilesCard className={cn('conversation-message', assistantReply && 'mt-4')} />
        {turnUsage && <TurnStats usage={turnUsage} className="conversation-message mt-3" />}
      </div>
    </div>
  )
}
