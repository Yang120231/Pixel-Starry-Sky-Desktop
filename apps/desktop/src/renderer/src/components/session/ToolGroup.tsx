import { useI18n } from '@/i18n/I18nProvider'
import type { ToolCall } from '@/mock/data'
import { ToolRow } from './ToolRow'

/** 工具调用组：左侧一条竖线把几行串起来 */
export function ToolGroup({ calls, searchHighlight }: { calls: ToolCall[]; searchHighlight?: string | null }) {
  useI18n()
  return (
    <div className="ml-[7px] flex flex-col border-l border-line pl-1.5">
      {calls.map((call, i) => (
        <div
          key={i}
          data-search-item={`demo-tool-${i}`}
          className={searchHighlight === `demo-tool-${i}` ? 'search-hit' : undefined}
        >
          <ToolRow call={call} />
        </div>
      ))}
    </div>
  )
}
