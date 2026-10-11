// 对话流（参考桌面端 docs/ui/conversation-concise.md）：一轮 = 用户消息 + 过程收成一行 + 回复和改动展开。
// 运行中的一轮露出最近 2 步；点开过程能看每一步，命令和工具再点开看输出。
import { useState, type ReactNode } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileDiff,
  Image as ImageIcon,
  Info,
  ListTodo,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { processSummary, stepTitle, turnDuration, type TurnView } from '@/data/turns'
import { DiffView, Dot, Spinner, Typing, cn } from '@/ui'
import { MarkdownText } from '@/ui/Markdown'

interface Props {
  turn: TurnView
  running: boolean
  /** 在等用户审批 / 回答（不是在思考） */
  waiting: boolean
  truncated: string[]
  onDetail(itemId: string): void
}

export function TurnBlock({ turn, running, waiting, truncated, onDetail }: Props) {
  const more = (id: string) =>
    truncated.includes(id) && (
      <button type="button" onClick={() => onDetail(id)} className="mt-1.5 text-meta font-medium text-accent-fg">
        内容较长，查看完整 ›
      </button>
    )
  const lastIsAnswer = turn.output.at(-1)?.kind === 'assistant'
  return (
    <div className="flex flex-col gap-3">
      {turn.user && <UserBubble item={turn.user} more={more(turn.user.id)} />}
      {(turn.process.length > 0 || (running && !lastIsAnswer)) && (
        <Process items={turn.process} running={running} waiting={waiting} more={more} />
      )}
      {turn.output.map(item => (
        <Output key={item.id} item={item} more={more(item.id)} />
      ))}
      {!running && turn.stats && (
        <div className="flex items-center gap-1.5 text-label text-fg-faint">
          {turn.stats.outcome === 'completed' ? <Check size={12} /> : <X size={12} />}
          {turn.stats.outcome === 'interrupted' ? '已停止' : turn.stats.outcome === 'failed' ? '出错了' : '完成'}
          {turnDuration(turn.stats) && <span>· {turnDuration(turn.stats)}</span>}
        </div>
      )}
    </div>
  )
}

function UserBubble({ item, more }: { item: Extract<Item, { kind: 'user' }>; more: ReactNode }) {
  return (
    <div className="flex flex-col items-end pl-10">
      <div className="rounded-2xl rounded-br-md bg-subtle px-3.5 py-2.5 text-prose break-words whitespace-pre-wrap text-fg">
        {item.text}
      </div>
      {!!item.attachments?.length && (
        <span className="mt-1 flex items-center gap-1 text-meta text-fg-muted">
          <ImageIcon size={14} /> {item.attachments.length} 张图片
        </span>
      )}
      {more}
    </div>
  )
}

const stepIcon = (item: Item) =>
  item.kind === 'command' ? (
    <SquareTerminal size={15} />
  ) : item.kind === 'reasoning' ? (
    <Brain size={15} />
  ) : (
    <Wrench size={15} />
  )

const failed = (item: Item) =>
  item.kind === 'command' ? item.status === 'failed' || !!item.exitCode : 'status' in item && item.status === 'failed'

/** 过程：收起时一行「已执行 N 步」；运行中露出最近 2 步 */
function Process({
  items,
  running,
  waiting,
  more,
}: {
  items: Item[]
  running: boolean
  waiting: boolean
  more(id: string): ReactNode
}) {
  const [open, setOpen] = useState(false)
  const steps = items.filter(i => i.kind !== 'reasoning' || i.text.trim())
  const shown = open ? steps : running ? steps.slice(-2) : []
  const errors = steps.filter(failed).length
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => steps.length && setOpen(o => !o)}
        className="flex min-h-9 items-center gap-2 self-start rounded-full py-1 pr-2 text-meta text-fg-muted"
      >
        {waiting ? (
          <Dot tone="danger" />
        ) : running ? (
          <Spinner size={12} className="text-fg-faint" />
        ) : (
          <Check size={14} className="text-fg-faint" />
        )}
        <span>
          {waiting
            ? `等你允许${steps.length ? ` · 已执行 ${steps.length} 步` : ''}`
            : running
              ? steps.length
                ? `正在执行 · ${steps.length} 步`
                : '正在思考'
              : processSummary(steps)}
        </span>
        {errors > 0 && <span className="text-danger">· {errors} 步出错</span>}
        {steps.length > 0 && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        {running && !waiting && !steps.length && <Typing />}
      </button>
      {shown.length > 0 && (
        <div className="ml-1.5 flex flex-col gap-1.5 border-l-2 border-line-subtle pl-3">
          {shown.map(item => (
            <Step key={item.id} item={item} more={more(item.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Step({ item, more }: { item: Item; more: ReactNode }) {
  const [open, setOpen] = useState(false)
  const body =
    item.kind === 'command' ? (
      <>
        <pre className="px-3 pt-2 font-mono text-label break-all whitespace-pre-wrap text-fg">$ {item.command}</pre>
        <Pre text={item.output} />
      </>
    ) : item.kind === 'tool' ? (
      <Pre text={item.output} />
    ) : item.kind === 'reasoning' ? (
      <p className="px-3 py-2 text-meta whitespace-pre-wrap text-fg-muted">{item.text}</p>
    ) : null
  const isRunning = 'status' in item && item.status === 'running'
  return (
    <div className="overflow-hidden rounded-xl bg-surface">
      <button
        type="button"
        onClick={() => body && setOpen(o => !o)}
        className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className={cn('shrink-0', failed(item) ? 'text-danger' : 'text-fg-muted')}>{stepIcon(item)}</span>
        <span className={cn('min-w-0 flex-1 truncate text-list', failed(item) ? 'text-danger' : 'text-fg-secondary')}>
          {stepTitle(item)}
        </span>
        {isRunning && <Spinner size={11} className="text-fg-faint" />}
        {item.kind === 'command' && !!item.exitCode && (
          <span className="text-label text-danger">退出码 {item.exitCode}</span>
        )}
        {body && (
          <ChevronRight size={15} className={cn('shrink-0 text-fg-faint transition-transform', open && 'rotate-90')} />
        )}
      </button>
      {open && (
        <div className="border-t border-line-subtle">
          {body}
          {more && <div className="px-3 pb-2">{more}</div>}
        </div>
      )}
    </div>
  )
}

function Pre({ text }: { text: string }) {
  if (!text) return <p className="px-3 py-2 text-meta text-fg-muted">没有输出</p>
  return (
    <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-label break-all whitespace-pre-wrap text-fg-secondary">
      {text}
    </pre>
  )
}

function Output({ item, more }: { item: Item; more: ReactNode }) {
  switch (item.kind) {
    case 'assistant':
      return (
        <div>
          <MarkdownText text={item.text} />
          {item.status === 'running' && (
            <div className={item.text ? 'mt-1.5' : undefined}>
              <Typing />
            </div>
          )}
          {more}
        </div>
      )
    case 'file_change':
      return <Changes item={item} more={more} />
    case 'todo':
      return (
        <div className="rounded-2xl border border-line-subtle bg-surface px-3.5 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-meta font-medium text-fg-muted">
            <ListTodo size={15} /> 计划 · {item.steps.filter(s => s.status === 'completed').length}/{item.steps.length}
          </div>
          <ul className="flex flex-col gap-1.5">
            {item.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-list">
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                    s.status === 'completed' ? 'border-success bg-success text-accent-on' : 'border-line-strong',
                    s.status === 'in_progress' && 'border-accent',
                  )}
                >
                  {s.status === 'completed' && <Check size={11} strokeWidth={3} />}
                  {s.status === 'in_progress' && <span className="size-1.5 rounded-full bg-accent" />}
                </span>
                <span
                  className={cn(
                    s.status === 'completed' && 'text-fg-faint line-through',
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
    case 'notice':
      return (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl px-3 py-2.5 text-meta',
            item.level === 'error'
              ? 'bg-subtle text-danger'
              : item.level === 'warn'
                ? 'bg-subtle text-warn'
                : 'text-fg-muted',
          )}
        >
          {item.level === 'info' ? (
            <Info size={15} className="mt-0.5 shrink-0" />
          ) : (
            <CircleAlert size={15} className="mt-0.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{item.text}</span>
        </div>
      )
    default:
      return null
  }
}

/** 改动文件：一张卡片，每个文件一行，点开看 diff */
function Changes({ item, more }: { item: Extract<Item, { kind: 'file_change' }>; more: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const added = item.changes.reduce((n, c) => n + c.added, 0)
  const removed = item.changes.reduce((n, c) => n + c.removed, 0)
  return (
    <div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface">
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-1 text-meta text-fg-muted">
        <FileDiff size={15} />
        改动了 {item.changes.length} 个文件
        <span className="ml-auto font-mono">
          <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
        </span>
      </div>
      {item.changes.map(c => {
        const name = c.path.split(/[\\/]/).pop()
        const dir = c.path.slice(0, c.path.length - (name?.length ?? 0)).replace(/[\\/]$/, '')
        return (
          <div key={c.path} className="border-t border-line-subtle first-of-type:border-t-0">
            <button
              type="button"
              onClick={() => setOpen(o => (o === c.path ? null : c.path))}
              className="flex min-h-12 w-full items-center gap-2 px-3.5 py-2 text-left active:bg-hover"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui">
                  {name}
                  {c.kind === 'add' && <span className="ml-1.5 text-label text-success">新建</span>}
                  {c.kind === 'delete' && <span className="ml-1.5 text-label text-danger">删除</span>}
                </span>
                {dir && <span className="truncate font-mono text-label text-fg-faint">{dir}</span>}
              </span>
              <span className="shrink-0 font-mono text-meta">
                <span className="text-success">+{c.added}</span> <span className="text-danger">−{c.removed}</span>
              </span>
              <ChevronRight
                size={15}
                className={cn('shrink-0 text-fg-faint transition-transform', open === c.path && 'rotate-90')}
              />
            </button>
            {open === c.path && (
              <div className="border-t border-line-subtle bg-subtle/50">
                <DiffView diff={c.diff} />
              </div>
            )}
          </div>
        )
      })}
      {more && <div className="px-3.5 pb-3">{more}</div>}
    </div>
  )
}
