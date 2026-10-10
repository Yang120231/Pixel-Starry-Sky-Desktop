import { tr } from '../../i18n/core'
// GitHub 提示块（docs/ui/content-highlight.md §2 G）：> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]
// remarkAlerts 把这种引用块标上 dataAlert，Markdown 的 blockquote 再画成带图标和彩色左边线的提示块；普通引用块不变。
import type { ReactNode } from 'react'
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/ui'

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

/** remark 语法树的节点（只用到这几个字段，不引入 mdast 类型） */
interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hProperties?: Record<string, unknown> }
}

/** GitHub 要求标记独占一行；模型有时把正文接在同一行后面，也认 */
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\r?\n|[ \t]+|$)/i

/** 引用块的第一段以 [!KIND] 开头时，返回种类并把标记从文字里去掉 */
export function takeAlertMarker(quote: MdNode): AlertKind | null {
  const first = quote.children?.[0]
  const text = first?.type === 'paragraph' ? first.children?.[0] : undefined
  if (!first || text?.type !== 'text' || !text.value) return null
  const m = MARKER.exec(text.value)
  if (!m) return null
  text.value = text.value.slice(m[0].length)
  // 标记后面紧跟着换行：段落第一个文字节点空了就去掉；整段只有标记时去掉这一段
  if (!text.value) first.children!.shift()
  if (first.children!.length === 0) quote.children!.shift()
  return m[1].toLowerCase() as AlertKind
}

function walk(node: MdNode): void {
  if (node.type === 'blockquote') {
    const kind = takeAlertMarker(node)
    if (kind) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataAlert: kind } }
  }
  node.children?.forEach(walk)
}

/** remark 插件：要放在 remark-breaks 前面（标记后的换行还是普通文字时才认得出） */
export function remarkAlerts() {
  return (tree: unknown): void => walk(tree as MdNode)
}

const ALERTS: Record<AlertKind, { icon: LucideIcon; tone: string }> = {
  note: { icon: Info, tone: 'border-accent text-accent-fg bg-accent/5' },
  tip: { icon: Lightbulb, tone: 'border-success text-success bg-success/5' },
  important: { icon: MessageSquareWarning, tone: 'border-ultracode text-ultracode bg-ultracode/5' },
  warning: { icon: TriangleAlert, tone: 'border-warn text-warn bg-warn/5' },
  caution: { icon: OctagonAlert, tone: 'border-danger text-danger bg-danger/5' },
}

export const isAlertKind = (value: unknown): value is AlertKind => typeof value === 'string' && value in ALERTS

export function Callout({ kind, children }: { kind: AlertKind; children?: ReactNode }) {
  const { icon: Icon, tone } = ALERTS[kind]
  return (
    <div data-alert={kind} className={cn('my-3 rounded-r-md border-l-2 py-2 pr-3 pl-3', tone)}>
      <div className="mb-1 flex items-center gap-1.5 text-list font-semibold">
        <Icon size={15} strokeWidth={1.75} className="shrink-0" />
        {tr(`content.alert.${kind}`)}
      </div>
      <div className="text-fg-body [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </div>
  )
}
