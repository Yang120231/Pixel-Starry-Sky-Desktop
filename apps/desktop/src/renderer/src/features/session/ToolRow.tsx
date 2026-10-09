import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Check, ChevronRight, FilePen, SquareTerminal } from 'lucide-react'
import { DiffStat, useComingSoon } from '@/ui'
import type { ToolCall } from '@/data'

/** 工具调用的一行：编辑文件 / 运行命令（13px，路径和命令用等宽字） */
export function ToolRow({ call }: { call: ToolCall }) {
  useI18n()
  const comingSoon = useComingSoon()
  if (call.kind === 'edit') {
    return (
      <div className="flex h-[30px] items-center gap-2 rounded-md px-2 text-list text-fg-secondary">
        <FilePen size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
        <span className="shrink-0">{tr('session.live.ItemRows.message253')}</span>
        <span className="truncate font-mono text-meta text-code-path">{call.path}</span>
        <DiffStat added={call.added} removed={call.removed} className="text-meta" />
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => comingSoon(tr('session.ToolRow.message370'))}
      className="press flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-list text-fg-secondary hover:bg-hover"
    >
      <SquareTerminal size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      <span className="shrink-0">{tr('session.live.ItemRows.message255')}</span>
      <code className="truncate rounded-sm bg-subtle px-1.5 py-0.5 font-mono text-meta text-fg">{call.command}</code>
      {call.ok && <Check size={14} strokeWidth={2} className="shrink-0 text-success" />}
      <span className="shrink-0 text-meta text-fg-muted tabular-nums">{call.duration}</span>
      <span className="flex-1" />
      <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
    </button>
  )
}
