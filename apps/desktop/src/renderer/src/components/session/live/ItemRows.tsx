import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
// 对话流里各种条目的显示（docs/engines.md §5.3、§11）
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Ban,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  Info,
  ListTodo,
  Plug,
  Search,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { FileChange, Item, ItemStatus, ToolKind } from '@pixelsky/protocol'
import { CopyButton, DiffStat, Spinner, cn } from '@/components/ui'
import { highlightLines, languageFromPath } from '@/components/code/highlight'
import { useOpenTrace } from './trace'
import { useItemNavigation } from '@/search/navigation'
import { openFile } from '@/files/store'
import { useActiveWorkspace } from '@/editor/target'
import { ImageAttachments } from '@/attachments/ImageAttachments'

type ItemOf<K extends Item['kind']> = Extract<Item, { kind: K }>

/** actions：气泡左侧、底部对齐的操作（悬停显示），不额外占行高 */
export function UserBubble({ item, actions }: { item: ItemOf<'user'>; actions?: ReactNode }) {
  useI18n()
  if (item.mode === 'guidance')
    return (
      <div className="border-l border-accent-line pl-3 text-list whitespace-pre-wrap text-fg-muted">
        <span className="mr-2 text-accent-fg">{tr('session.live.ItemRows.message241')}</span>
        {item.text}
      </div>
    )
  return (
    <div className="flex items-end justify-end gap-1">
      {actions}
      <div className="conversation-user-bubble rounded-2xl rounded-br-md bg-subtle px-4 py-2.5 text-prose break-words whitespace-pre-wrap text-fg">
        {!!item.attachments?.length && (
          <div className="mb-2">
            <ImageAttachments images={item.attachments} />
          </div>
        )}
        {item.text}
      </div>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  useI18n()
  return (
    <ChevronRight
      size={15}
      strokeWidth={1.5}
      className={cn('shrink-0 text-fg-muted transition-transform duration-(--dur-fast)', open && 'rotate-90')}
    />
  )
}

/** 思考过程：默认折叠，进行中显示「思考中」 */
export function ReasoningBlock({ item }: { item: ItemOf<'reasoning'> }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const running = item.status === 'running'
  if (!running && !item.text.trim()) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex h-[30px] items-center gap-2 rounded-md px-2 text-list text-fg-muted hover:bg-hover hover:text-fg-secondary"
      >
        <Brain size={15} strokeWidth={1.5} className="shrink-0" />
        <span>{running ? tr('session.live.ItemRows.message242') : tr('session.live.ItemRows.message243')}</span>
        {running ? <Spinner size={13} /> : <Chevron open={open} />}
      </button>
      {open && item.text && (
        <div className="mt-1 ml-[15px] border-l border-line pl-3.5 text-meta leading-relaxed whitespace-pre-wrap text-fg-muted">
          {item.text}
        </div>
      )}
    </div>
  )
}

/**
 * 带颜色的 diff（只用设计变量：增加行绿底、删除行红底）。给了 path 且认得文件类型时做语法高亮：
 * 行首 +/− 保持绿 / 红，代码本身用 --syn-* 着色（参考 Mirasim）。见 docs/ui/code-highlight.md
 */
export function DiffView({ diff, path, className }: { diff: string; path?: string; className?: string }) {
  useI18n()
  const lines = useMemo(() => diff.split('\n'), [diff])
  // 去掉每行开头的 +/−/空格 后整段高亮（跨行的注释、字符串颜色才对）；@@ 段头和 ---/+++ 文件头不参与
  const code = useMemo(() => {
    const lang = languageFromPath(path)
    if (!lang) return null
    return highlightLines(lines.map(l => (isCodeLine(l) ? l.slice(1) : '')).join('\n'), lang)
  }, [lines, path])
  if (!diff)
    return (
      <div className={cn('px-3 py-2 text-meta text-fg-faint', className)}>{tr('session.live.ItemRows.message244')}</div>
    )
  return (
    <pre className={cn('overflow-auto font-mono text-meta leading-[1.6]', className)}>
      {lines.map((line, i) => {
        const highlighted = code !== null && isCodeLine(line)
        return (
          <div
            key={i}
            className={cn(
              'px-3 whitespace-pre',
              line.startsWith('+') && cn('bg-success/10', highlighted ? 'text-fg' : 'text-success'),
              line.startsWith('-') && cn('bg-danger/10', highlighted ? 'text-fg' : 'text-danger'),
              line.startsWith('@@') && 'text-fg-faint',
              line.startsWith(' ') && 'text-fg-secondary',
            )}
          >
            {highlighted ? (
              <>
                <span className={line[0] === '+' ? 'text-success' : line[0] === '-' ? 'text-danger' : undefined}>
                  {line[0]}
                </span>
                {code[i]}
              </>
            ) : (
              line || ' '
            )}
          </div>
        )
      })}
    </pre>
  )
}

/** 带 +/−/空格 前缀的代码行（不是 @@ 段头，也不是 ---/+++ 文件头） */
function isCodeLine(line: string): boolean {
  if (line.startsWith('+++') || line.startsWith('---')) return false
  return line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')
}

function StatusMark({ status, okMark = true }: { status: ItemStatus; okMark?: boolean }) {
  useI18n()
  switch (status) {
    case 'running':
      return <Spinner size={13} />
    case 'completed':
      return okMark ? <Check size={14} strokeWidth={2} className="shrink-0 text-success" /> : null
    case 'failed':
      return <X size={14} strokeWidth={2} className="shrink-0 text-danger" />
    case 'declined':
      return (
        <span className="inline-flex shrink-0 items-center gap-1 text-meta text-fg-muted">
          <Ban size={12} strokeWidth={1.75} />
          {tr('session.live.ItemRows.message245')}
        </span>
      )
    case 'interrupted':
      return <span className="shrink-0 text-meta text-fg-muted">{tr('session.live.ItemRows.message246')}</span>
  }
}

const TOOL_META: Record<ToolKind, { icon: LucideIcon; verb: string }> = {
  read: {
    icon: FileText,
    get verb() {
      return tr('session.live.ItemRows.message247')
    },
  },
  search: {
    icon: Search,
    get verb() {
      return tr('session.live.ItemRows.message248')
    },
  },
  web: {
    icon: Globe,
    get verb() {
      return tr('session.live.ItemRows.message249')
    },
  },
  mcp: { icon: Plug, verb: 'MCP' },
  task: {
    icon: Bot,
    get verb() {
      return tr('session.live.ItemRows.message250')
    },
  },
  other: { icon: Wrench, verb: '' },
}

function Row({
  icon: Icon,
  verb,
  children,
  trailing,
  expandable,
  open,
  onToggle,
  action,
}: {
  icon: LucideIcon
  verb: string
  children: ReactNode
  trailing?: ReactNode
  expandable: boolean
  open: boolean
  onToggle: () => void
  /** 行尾的额外按钮（放在行按钮外面，不能嵌套按钮） */
  action?: ReactNode
}) {
  useI18n()
  const row = (
    <button
      type="button"
      onClick={expandable ? onToggle : undefined}
      className={cn(
        'flex h-[30px] w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-list text-fg-secondary',
        expandable ? 'hover:bg-hover' : 'cursor-default',
      )}
    >
      <Icon size={15} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      {verb && <span className="shrink-0">{verb}</span>}
      {children}
      {trailing}
      <span className="flex-1" />
      {expandable && <Chevron open={open} />}
    </button>
  )
  if (!action) return row
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">{row}</div>
      {action}
    </div>
  )
}

/** 工具行上的小标签：是哪个子智能体调用的 */
function SubagentTag({ name }: { name?: string }) {
  useI18n()
  if (!name) return null
  return (
    <span
      className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded-sm bg-subtle px-1.5 text-label text-fg-muted"
      title={tr('session.live.ItemRows.message251', { p0: name })}
    >
      <Bot size={11} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}

const OUTPUT_BOX = 'mt-1 mb-1.5 ml-[23px] max-h-72 overflow-auto rounded-lg border border-line-card bg-subtle'

function fileVerb(changes: FileChange[]): string {
  return changes.length === 1 && changes[0].kind === 'add'
    ? tr('session.live.ItemRows.message252')
    : tr('session.live.ItemRows.message253')
}

/** 工具调用的一行：运行命令 / 编辑文件 / 读取 / 搜索 / 网页 / MCP / 子任务；点开看输出或 diff */
export function ToolItemRow({ item }: { item: ItemOf<'command' | 'file_change' | 'tool'> }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const location = useItemNavigation()
  const row = useRef<HTMLDivElement>(null)
  const workspace = useActiveWorkspace(),
    [fileError, setFileError] = useState('')
  useEffect(() => {
    if (
      location?.itemId === item.id &&
      row.current?.closest<HTMLElement>('[data-search-session]')?.dataset.searchSession === location.sessionId
    )
      setOpen(true)
  }, [location, item.id])
  const openTrace = useOpenTrace()
  const toggle = () => setOpen(v => !v)
  const openChangedFile = (change: FileChange): void => {
    const sessionId = row.current?.closest<HTMLElement>('[data-search-session]')?.dataset.searchSession
    const ref = sessionId ? { sessionId } : workspace.ref
    if (!ref) return
    const added = change.diff
      .split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.slice(1))
      .join('\n')
    void openFile(ref, change.path, undefined, 1, change.newText || added).catch(e => setFileError(e.message))
  }

  if (item.kind === 'command') {
    const verb =
      item.status === 'running' ? tr('session.live.ItemRows.message254') : tr('session.live.ItemRows.message255')
    return (
      <div ref={row}>
        <Row
          icon={SquareTerminal}
          verb={verb}
          expandable={!!item.output}
          open={open}
          onToggle={toggle}
          trailing={
            <>
              <StatusMark status={item.status} />
              <SubagentTag name={item.subagent} />
            </>
          }
        >
          <code
            className="truncate rounded-sm bg-subtle px-1.5 py-0.5 font-mono text-[length:calc(12.5px*var(--font-scale,1))] text-fg"
            title={item.description ?? item.command}
          >
            {item.command}
          </code>
        </Row>
        {open && item.output && (
          <pre
            className={cn(OUTPUT_BOX, 'p-3 font-mono text-meta leading-[1.6] whitespace-pre-wrap text-fg-secondary')}
          >
            {item.output}
          </pre>
        )}
      </div>
    )
  }

  if (item.kind === 'file_change') {
    const added = item.changes.reduce((n, c) => n + c.added, 0)
    const removed = item.changes.reduce((n, c) => n + c.removed, 0)
    return (
      <div ref={row}>
        <div className="flex min-h-[30px] min-w-0 items-center gap-2 rounded-md px-2 text-list text-fg-secondary">
          {item.changes[0]?.kind === 'add' ? (
            <FilePlus size={15} className="shrink-0 text-fg-muted" />
          ) : (
            <FilePen size={15} className="shrink-0 text-fg-muted" />
          )}
          <span className="shrink-0">{fileVerb(item.changes)}</span>
          <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
            {item.changes.map(c => (
              <button
                key={c.path}
                type="button"
                title={tr('session.live.ItemRows.message256', { p0: c.path })}
                onClick={() => openChangedFile(c)}
                className="truncate text-left font-mono text-meta text-code-path hover:underline"
              >
                {c.path}
              </button>
            ))}
          </div>
          {(added > 0 || removed > 0) && <DiffStat added={added} removed={removed} className="text-meta" />}
          <StatusMark status={item.status} okMark={false} />
          <SubagentTag name={item.subagent} />
          {item.changes.some(c => c.diff) && (
            <button
              aria-label={open ? tr('session.live.ItemRows.message257') : tr('session.live.ItemRows.message258')}
              onClick={toggle}
              className="rounded-sm p-1 hover:bg-hover"
            >
              <Chevron open={open} />
            </button>
          )}
        </div>
        {fileError && (
          <p role="status" className="px-2 text-meta text-danger">
            {fileError}
          </p>
        )}
        {open && (
          <div className={cn(OUTPUT_BOX, 'bg-surface py-1.5')}>
            {item.changes.map(c => (
              <div key={c.path}>
                {item.changes.length > 1 && <div className="px-3 pt-1 font-mono text-meta text-fg-muted">{c.path}</div>}
                <DiffView diff={c.diff} path={c.path} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const meta = TOOL_META[item.tool]
  // 子任务（Agent 工具）和多智能体编排（Workflow 工具）可以打开智能体追踪
  const traceable = !!openTrace && item.tool === 'task' && !item.subagent
  return (
    <div ref={row}>
      <Row
        icon={meta.icon}
        verb={item.name === 'Workflow' ? tr('session.live.ItemRows.message259') : meta.verb || item.name}
        expandable={!!item.output}
        open={open}
        onToggle={toggle}
        trailing={
          <>
            <StatusMark status={item.status} okMark={false} />
            <SubagentTag name={item.subagent} />
          </>
        }
        action={
          traceable ? (
            <button
              type="button"
              onClick={() => openTrace?.({ toolUseId: item.id })}
              className="shrink-0 rounded-md px-1.5 py-1 text-meta text-accent-fg hover:bg-hover"
            >
              {tr('session.live.ItemRows.message260')}{' '}
            </button>
          ) : undefined
        }
      >
        <span className="truncate text-fg-muted" title={item.title}>
          {item.title}
        </span>
      </Row>
      {open && item.output && (
        <pre className={cn(OUTPUT_BOX, 'p-3 font-mono text-meta leading-[1.6] whitespace-pre-wrap text-fg-secondary')}>
          {item.output}
        </pre>
      )}
    </div>
  )
}

/** 待办清单（Claude 的 TodoWrite） */
export function TodoCard({ item }: { item: ItemOf<'todo'> }) {
  useI18n()
  if (item.steps.length === 0) return null
  const done = item.steps.filter(s => s.status === 'completed').length
  return (
    <div className="rounded-xl border border-line-card bg-surface px-3.5 py-3 shadow-sm">
      <div className="mb-1.5 flex items-center gap-2 text-list text-fg-secondary">
        <ListTodo size={15} strokeWidth={1.5} className="text-fg-muted" />
        <span>{tr('session.live.ItemRows.message261')}</span>
        <span className="text-meta text-fg-faint tabular-nums">
          {done}/{item.steps.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {item.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-list">
            <span
              className={cn(
                'mt-[3px] inline-flex size-[14px] shrink-0 items-center justify-center rounded-full border',
                s.status === 'completed' ? 'border-success bg-success text-surface' : 'border-line-strong',
                s.status === 'in_progress' && 'border-accent',
              )}
            >
              {s.status === 'completed' && <Check size={10} strokeWidth={3} />}
              {s.status === 'in_progress' && <span className="size-1.5 rounded-full bg-accent" />}
            </span>
            <span
              className={cn(
                s.status === 'completed' ? 'text-fg-muted line-through' : 'text-fg',
                s.status === 'in_progress' && 'font-medium',
              )}
            >
              {s.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 提示：信息 / 警告 / 错误 */
export function NoticeRow({ item }: { item: ItemOf<'notice'> }) {
  useI18n()
  const [open, setOpen] = useState(false)
  const Icon = item.level === 'error' ? CircleAlert : item.level === 'warn' ? TriangleAlert : Info
  const text = translateMessage(item.text)
  // 引擎给了原始报错详情（附加说明、错误类型、HTTP 状态码）时可展开查看和复制
  const detail = item.detail?.trim() || null
  return (
    <div
      data-notice-level={item.level}
      className={cn(
        'rounded-lg px-3 py-2 text-list',
        item.level === 'error' && 'border border-danger/30 bg-danger/5 text-danger',
        item.level === 'warn' && 'text-warn',
        item.level === 'info' && 'text-fg-muted',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon size={15} strokeWidth={1.5} className="mt-[2px] shrink-0" />
        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{text}</span>
        {detail && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
            className="press -my-0.5 inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-meta opacity-80 hover:bg-danger/10 hover:opacity-100"
          >
            {tr(open ? 'session.notice.hideDetail' : 'session.notice.showDetail')}
            <ChevronRight
              size={13}
              strokeWidth={1.5}
              className={cn('transition-transform duration-(--dur-fast)', open && 'rotate-90')}
            />
          </button>
        )}
      </div>
      {detail && open && (
        <div
          data-notice-detail
          className="mt-2 ml-[23px] rounded-md border border-line-subtle bg-surface/70 text-fg-secondary"
        >
          <pre className="selectable max-h-60 overflow-auto px-3 py-2 font-mono text-meta break-all whitespace-pre-wrap">
            {detail}
          </pre>
          <div className="flex justify-end border-t border-line-subtle px-1.5 py-1">
            <CopyButton text={`${text}\n${detail}`} label={tr('session.notice.copyDetail')} />
          </div>
        </div>
      )}
    </div>
  )
}
