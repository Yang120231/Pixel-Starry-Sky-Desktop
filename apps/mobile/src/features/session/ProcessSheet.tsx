// 点开「做了 N 步」的面板：按原顺序列出这一段过程的每一步（命令、工具、改动、思考、待办、中间的话）。
// 子智能体名下的步骤缩进并标出名字；命令和工具再点开看输出，被截断的有「查看完整」。
import type { ReactNode } from 'react'
import type { Item } from '@pixelsky/protocol'
import { L } from '@/i18n'
import { MarkdownText } from '@/ui/Markdown'
import { Sheet } from '@/ui/sheet'
import { Changes, Step, TodoCard, type TurnActions } from './steps'

export function ProcessSheet({
  title,
  items,
  more,
  actions,
  onClose,
}: {
  title: ReactNode
  items: Item[]
  more(id: string): ReactNode
  actions: TurnActions
  onClose(): void
}) {
  const rows = items.filter(i => i.kind !== 'notice' || i.level !== 'info')
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="flex flex-col gap-2 px-4 py-3">
        {rows.length === 0 && (
          <p className="py-6 text-center text-meta text-fg-muted">{L('没有可看的步骤', 'No steps to show')}</p>
        )}
        {rows.map(item => {
          const sub = 'subagent' in item ? item.subagent : undefined
          return (
            <div key={item.id} className={sub ? 'ml-4 border-l-2 border-line-subtle pl-2' : undefined}>
              {sub && <div className="mb-1 truncate text-label text-fg-faint">{sub}</div>}
              <Row item={item} more={more(item.id)} actions={actions} />
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}

function Row({ item, more, actions }: { item: Item; more: ReactNode; actions: TurnActions }) {
  switch (item.kind) {
    case 'file_change':
      return <Changes item={item} more={more} />
    case 'todo':
      return <TodoCard item={item} />
    case 'assistant':
      return item.text.trim() ? (
        <div className="text-fg-secondary">
          <MarkdownText text={item.text} />
          {more}
        </div>
      ) : null
    case 'reasoning':
      return item.text.trim() ? <Step item={item} more={more} actions={actions} /> : null
    case 'command':
    case 'tool':
      return <Step item={item} more={more} actions={actions} />
    case 'notice':
      return <p className="text-meta break-words text-fg-muted">{item.text}</p>
    default:
      return null
  }
}
