import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
// 对话流里各种条目的显示（docs/engines.md §5.3、§11）
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Ban,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  Info,
  ListTodo,
  Plug,
  Search,
  SquareArrowOutUpRight,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { FileChange, Item, ItemStatus, ToolKind } from '@pixelsky/protocol'
import { CopyButton, DiffStat, IconButton, Spinner, cn } from '@/ui'
import { DiffView } from '@/ui/code/DiffView'
import { CommandText } from '@/ui/code/CommandText'
import { AnsiText } from '@/ui/code/AnsiText'
import { useOpenTrace } from './trace'
import { StepMark } from './ProgressCard'
import { UserText } from './UserText'
import { shouldFoldUser, userBlocks } from './userBlocks'
import { CodeBlock } from '@/ui/code/CodeBlock'
import { freshRequest, useExpandRequest } from '@/features/search/expand'
import { openFile } from '@/features/files/store'
import { getActiveWorkspace } from '@/features/editor/target'
import { ImageAttachments } from '@/features/session/attachments/ImageAttachments'

type ItemOf<K extends Item['kind']> = Extract<Item, { kind: K }>

/** actions：气泡左侧、底部对齐的操作（悬停显示），不额外占行高 */
export function UserBubble({ item, actions }: { item: ItemOf<'user'>; actions?: ReactNode }) {
  useI18n()
  if (item.mode === 'guidance')
    return (
      <div className="border-l border-accent-line pl-3 text-list whitespace-pre-wrap text-fg-muted">
        <span className="mr-2 text-accent-fg">{tr('session.live.ItemRows.steered')}</span>
        <UserText text={item.text} />
      </div>
    )
  return (
    <div className="flex items-end justify-end gap-1">
      {actions}
      <div className="conversation-user-bubble min-w-0 rounded-2xl rounded-br-md bg-subtle px-4 py-2.5 text-prose break-words whitespace-pre-wrap text-fg">
        {!!item.attachments?.length && (
          <div className="mb-2">
            <ImageAttachments images={item.attachments} />
          </div>
        )}
        <UserBody id={item.id} text={item.text} />
      </div>
    </div>
  )
}

/**
 * 用户消息正文（docs/ui/conversation-ux-2.md §2.4）：代码块按代码显示；长消息只显示前面一段，底部渐隐。
 * 折叠时全文仍在页面上（只是被裁掉）：对话内搜索照常能搜到，跳到被裁掉的命中时点 data-folded 里的展开按钮；
 * 全局搜索跳到这条消息时也展开。
 */
function UserBody({ id, text }: { id: string; text: string }) {
  useI18n()
  const blocks = useMemo(() => userBlocks(text), [text])
  const foldable = shouldFoldUser(text)
  const [expanded, setExpanded] = useState(false)
  const request = useExpandRequest(id)
  useEffect(() => {
    if (freshRequest(request)) setExpanded(true)
  }, [request])
  const folded = foldable && !expanded
  return (
    <div data-folded={folded || undefined}>
      <div className={cn('relative', folded && 'max-h-[12lh] overflow-hidden')}>
        {blocks.map((b, i) =>
          b.kind === 'code' ? (
            <CodeBlock key={i} code={b.code} lang={b.lang} className="my-2 whitespace-normal" />
          ) : (
            <UserText key={i} text={b.text} leading={i === 0} />
          ),
        )}
        {folded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-subtle to-transparent" />
        )}
      </div>
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          className="press mt-1 inline-flex items-center gap-1 rounded-md text-meta whitespace-normal text-fg-muted hover:text-fg"
        >
          {expanded ? <ChevronUp size={13} strokeWidth={1.75} /> : <ChevronDown size={13} strokeWidth={1.75} />}
          {expanded ? tr('session.live.UserBody.collapse') : tr('session.live.UserBody.expand')}
        </button>
      )}
    </div>
  )
}

/**
 * 可折叠条目的展开状态：点击切换；对话内搜索的「展开」和搜索跳转也会让它展开（features/search/expand.ts）。
 * fold 放在条目根元素的 data-fold 上：对话内搜索据此知道哪些条目折叠着（docs/ui/conversation-ux.md §2.6）
 */
function useFold(id: string, foldable: boolean): { open: boolean; toggle: () => void; fold?: 'open' | 'closed' } {
  const [open, setOpen] = useState(false)
  const request = useExpandRequest(id)
  useEffect(() => {
    if (freshRequest(request)) setOpen(true)
  }, [request])
  return { open, toggle: () => setOpen(v => !v), fold: foldable ? (open ? 'open' : 'closed') : undefined }
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
  const running = item.status === 'running'
  const { open, toggle, fold } = useFold(item.id, !!item.text.trim())
  if (!running && !item.text.trim()) return null
  return (
    <div data-fold={fold}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-[30px] items-center gap-2 rounded-md px-2 text-list text-fg-muted hover:bg-hover hover:text-fg-secondary"
      >
        <Brain size={15} strokeWidth={1.5} className="shrink-0" />
        <span>{running ? tr('session.live.ItemRows.thinking') : tr('session.live.ItemRows.thinking2')}</span>
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
          {tr('session.live.ItemRows.denied')}
        </span>
      )
    case 'interrupted':
      return <span className="shrink-0 text-meta text-fg-muted">{tr('session.live.ItemRows.interrupted')}</span>
  }
}

const TOOL_META: Record<ToolKind, { icon: LucideIcon; verb: string }> = {
  read: {
    icon: FileText,
    get verb() {
      return tr('session.live.ItemRows.read')
    },
  },
  search: {
    icon: Search,
    get verb() {
      return tr('session.live.ItemRows.search')
    },
  },
  web: {
    icon: Globe,
    get verb() {
      return tr('session.live.ItemRows.web')
    },
  },
  mcp: { icon: Plug, verb: 'MCP' },
  task: {
    icon: Bot,
    get verb() {
      return tr('session.live.ItemRows.subtask')
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
      aria-expanded={expandable ? open : undefined}
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
      title={tr('session.live.ItemRows.subagentCall', { p0: name })}
    >
      <Bot size={11} strokeWidth={1.75} className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}

const OUTPUT_BOX = 'mt-1 mb-1.5 ml-[23px] max-h-72 overflow-auto rounded-lg border border-line-card bg-subtle'

function fileVerb(changes: FileChange[]): string {
  return changes.length === 1 && changes[0].kind === 'add'
    ? tr('session.live.ItemRows.create')
    : tr('session.live.ItemRows.edit')
}

/** 工具调用的一行：运行命令 / 编辑文件 / 读取 / 搜索 / 网页 / MCP / 子任务；点开看输出或 diff。条目没变就不重新渲染 */
export const ToolItemRow = memo(function ToolItemRow({ item }: { item: ItemOf<'command' | 'file_change' | 'tool'> }) {
  useI18n()
  const foldable = item.kind === 'file_change' ? item.changes.some(c => c.diff) : !!item.output
  const { open, toggle, fold } = useFold(item.id, foldable)
  const row = useRef<HTMLDivElement>(null)
  const [fileError, setFileError] = useState('')
  const openTrace = useOpenTrace()
  const openChangedFile = (change: FileChange): void => {
    const sessionId = row.current?.closest<HTMLElement>('[data-search-session]')?.dataset.searchSession
    const ref = sessionId ? { sessionId } : getActiveWorkspace().ref
    if (!ref) return
    const added = change.diff
      .split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.slice(1))
      .join('\n')
    void openFile(ref, change.path, undefined, 1, change.newText || added).catch(e => setFileError(e.message))
  }

  if (item.kind === 'command') {
    const verb = item.status === 'running' ? tr('session.live.ItemRows.running') : tr('session.live.ItemRows.ran')
    return (
      <div ref={row} data-fold={fold}>
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
            <CommandText command={item.command} />
          </code>
        </Row>
        {open && item.output && (
          <pre
            className={cn(OUTPUT_BOX, 'p-3 font-mono text-meta leading-[1.6] whitespace-pre-wrap text-fg-secondary')}
          >
            <AnsiText text={item.output} />
          </pre>
        )}
      </div>
    )
  }

  if (item.kind === 'file_change') {
    const added = item.changes.reduce((n, c) => n + c.added, 0)
    const removed = item.changes.reduce((n, c) => n + c.removed, 0)
    const single = item.changes.length === 1
    // 有 diff 时点行展开 / 收起，打开编辑器用单独的图标；没有 diff 时点路径直接打开（docs/ui/changes-inline-diff.md）
    const openButton = (c: FileChange): ReactNode => (
      <IconButton
        icon={SquareArrowOutUpRight}
        label={tr('session.ChangedFilesCard.openInEditor')}
        size={24}
        iconSize={13}
        onClick={() => openChangedFile(c)}
      />
    )
    const paths = (
      <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
        {item.changes.map(c =>
          foldable ? (
            <span key={c.path} className="truncate font-mono text-meta text-code-path">
              {c.path}
            </span>
          ) : (
            <button
              key={c.path}
              type="button"
              title={tr('session.live.ItemRows.openInPixelStarry', { p0: c.path })}
              onClick={() => openChangedFile(c)}
              className="truncate text-left font-mono text-meta text-code-path hover:underline"
            >
              {c.path}
            </button>
          ),
        )}
      </div>
    )
    const summary = (
      <>
        {item.changes[0]?.kind === 'add' ? (
          <FilePlus size={15} className="shrink-0 text-fg-muted" />
        ) : (
          <FilePen size={15} className="shrink-0 text-fg-muted" />
        )}
        <span className="shrink-0">{fileVerb(item.changes)}</span>
        {paths}
        {(added > 0 || removed > 0) && <DiffStat added={added} removed={removed} className="text-meta" />}
        <StatusMark status={item.status} okMark={false} />
        <SubagentTag name={item.subagent} />
      </>
    )
    return (
      <div ref={row} data-fold={fold}>
        {foldable ? (
          <div className="group/file flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-expanded={open}
              title={tr(open ? 'session.ChangedFilesCard.hideChanges' : 'session.ChangedFilesCard.showChanges')}
              onClick={toggle}
              className="flex min-h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-list text-fg-secondary hover:bg-hover"
            >
              {summary}
              <Chevron open={open} />
            </button>
            {single && (
              <span
                className={cn('opacity-0 group-hover/file:opacity-100 focus-within:opacity-100', open && 'opacity-100')}
              >
                {openButton(item.changes[0])}
              </span>
            )}
          </div>
        ) : (
          <div className="flex min-h-[30px] min-w-0 items-center gap-2 rounded-md px-2 text-list text-fg-secondary">
            {summary}
          </div>
        )}
        {fileError && (
          <p role="status" className="px-2 text-meta text-danger">
            {fileError}
          </p>
        )}
        {open && (
          <div className={cn(OUTPUT_BOX, 'bg-surface py-1.5')}>
            {item.changes.map(c => (
              <div key={c.path}>
                {!single && (
                  <div className="flex items-center gap-1 pr-1.5 pl-3 font-mono text-meta text-fg-muted">
                    <span className="min-w-0 flex-1 truncate">{c.path}</span>
                    {openButton(c)}
                  </div>
                )}
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
    <div ref={row} data-fold={fold}>
      <Row
        icon={meta.icon}
        verb={item.name === 'Workflow' ? tr('session.live.ItemRows.orchestration') : meta.verb || item.name}
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
              {tr('session.live.ItemRows.viewActivity')}{' '}
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
          <AnsiText text={item.output} />
        </pre>
      )}
    </div>
  )
})

/** 待办清单（Claude 的 TodoWrite、Codex 的计划）：一行概要，点开看完整列表；当前计划常驻在进度卡片里（docs/ui/progress-card.md §5） */
export function TodoCard({ item }: { item: ItemOf<'todo'> }) {
  useI18n()
  const { open, toggle, fold } = useFold(item.id, item.steps.length > 0)
  if (item.steps.length === 0) return null
  const done = item.steps.filter(s => s.status === 'completed').length
  const current = item.steps.find(s => s.status === 'in_progress')
  const note = current
    ? tr('session.todo.current', { text: current.text })
    : done === item.steps.length
      ? tr('session.todo.allDone')
      : null
  return (
    <div data-fold={fold}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-[30px] max-w-full min-w-0 items-center gap-2 rounded-md px-2 text-list text-fg-muted hover:bg-hover hover:text-fg-secondary"
      >
        <ListTodo size={15} strokeWidth={1.5} className="shrink-0" />
        <span className="shrink-0">{tr('session.live.ItemRows.toDo')}</span>
        <span className="shrink-0 text-meta text-fg-faint tabular-nums">
          {done}/{item.steps.length}
        </span>
        {note && <span className="min-w-0 truncate text-fg-faint">{note}</span>}
        <Chevron open={open} />
      </button>
      {open && (
        <ul className="mt-1 ml-[15px] flex flex-col gap-1 border-l border-line pl-3.5">
          {item.steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-list">
              <StepMark status={s.status} />
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
      )}
    </div>
  )
}

/** 提示：信息 / 警告 / 错误 */
export function NoticeRow({ item }: { item: ItemOf<'notice'> }) {
  useI18n()
  const Icon = item.level === 'error' ? CircleAlert : item.level === 'warn' ? TriangleAlert : Info
  const text = translateMessage(item.text)
  // 引擎给了原始报错详情（附加说明、错误类型、HTTP 状态码）时可展开查看和复制
  const detail = item.detail?.trim() || null
  const { open, toggle, fold } = useFold(item.id, !!detail)
  return (
    <div
      data-fold={fold}
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
            onClick={toggle}
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
