// 对话流（参考桌面端 docs/ui/conversation-concise.md）：一轮 = 用户消息 + 过程收成一行 + 回复和改动展开。
// 运行中的一轮露出最近 2 步；点开过程能看每一步，命令和工具再点开看输出。
// 图片点开再向电脑取；回复可以复制；最近一轮出错时错误下面有「重试」（docs/mobile-remote.md §17）。
import { useState, type ReactNode } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileDiff,
  FileText,
  Info,
  RotateCcw,
  ListTodo,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react'
import type { ImageAttachment, Item } from '@pixelsky/protocol'
import { imageError, imageKey, knownImage } from '@/data/images'
import { processSummary, stepTitle, turnDuration, type TurnView } from '@/data/turns'
import { Button, DiffView, Dot, Spinner, Typing, cn } from '@/ui'
import { CopyButton } from '@/ui/code'
import { ImageTiles } from '@/ui/images'
import { MarkdownText } from '@/ui/Markdown'

/** 对话里要用到的操作（会话页传进来） */
export interface TurnActions {
  sessionId: string
  /** 向电脑取第 index 张图，返回地址 */
  image(itemId: string, index: number): Promise<string>
  /** 全屏看图 */
  view(src: string): void
  /** 挂「重试」的那条错误 */
  retryId: string | null
  retrying: boolean
  retry(): void
}

interface Props {
  turn: TurnView
  running: boolean
  /** 在等用户审批 / 回答（不是在思考） */
  waiting: boolean
  truncated: string[]
  onDetail(itemId: string): void
  actions: TurnActions
}

export function TurnBlock({ turn, running, waiting, truncated, onDetail, actions }: Props) {
  const more = (id: string) =>
    truncated.includes(id) && (
      <button type="button" onClick={() => onDetail(id)} className="mt-1.5 text-meta font-medium text-accent-fg">
        内容较长，查看完整 ›
      </button>
    )
  const lastIsAnswer = turn.output.at(-1)?.kind === 'assistant'
  // 一轮最后那段回复下面放「复制」（被截断的先「查看完整」再复制，免得复制不全）
  const answer = turn.output.findLast(i => i.kind === 'assistant')
  const copyId =
    answer?.kind === 'assistant' && answer.status !== 'running' && answer.text && !truncated.includes(answer.id)
      ? answer.id
      : null
  return (
    <div className="flex flex-col gap-3">
      {turn.user && <UserBubble item={turn.user} more={more(turn.user.id)} actions={actions} />}
      {(turn.process.length > 0 || (running && !lastIsAnswer)) && (
        <Process items={turn.process} running={running} waiting={waiting} more={more} actions={actions} />
      )}
      {turn.output.map(item => (
        <Output key={item.id} item={item} more={more(item.id)} copy={item.id === copyId} actions={actions} />
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

/** 消息里的图片：有的直接显示，没有的显示尺寸，点了向电脑取 */
function MessageImages({
  itemId,
  images,
  actions,
  align,
}: {
  itemId: string
  images: ImageAttachment[]
  actions: TurnActions
  align?: 'start' | 'end'
}) {
  const [urls, setUrls] = useState<(string | null)[]>(() =>
    images.map((img, i) => knownImage(img, imageKey(actions.sessionId, itemId, i))),
  )
  const [loading, setLoading] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const open = async (i: number) => {
    const have = urls[i] ?? knownImage(images[i], imageKey(actions.sessionId, itemId, i))
    if (have) return actions.view(have)
    if (loading !== null) return
    setLoading(i)
    setError(null)
    try {
      const url = await actions.image(itemId, i)
      setUrls(list => list.map((x, j) => (j === i ? url : x)))
      actions.view(url)
    } catch (e) {
      setError(imageError(e))
    } finally {
      setLoading(null)
    }
  }
  return (
    <div className={cn('flex flex-col gap-1', align === 'end' && 'items-end')}>
      <ImageTiles
        align={align}
        onOpen={i => void open(i)}
        tiles={images.map((img, i) => ({
          key: img.id + '/' + i,
          src: urls[i],
          label: img.width && img.height ? `${img.width}×${img.height}` : '图片',
          loading: loading === i,
        }))}
      />
      {error && <span className="text-label text-danger">{error}</span>}
    </div>
  )
}

function UserBubble({
  item,
  more,
  actions,
}: {
  item: Extract<Item, { kind: 'user' }>
  more: ReactNode
  actions: TurnActions
}) {
  return (
    <div className="flex flex-col items-end pl-10">
      {(item.text || (!item.files?.length && !item.attachments?.length)) && (
        <div className="rounded-2xl rounded-br-md bg-subtle px-3.5 py-2.5 text-prose break-words whitespace-pre-wrap text-fg">
          {item.text}
        </div>
      )}
      {!!item.attachments?.length && (
        <div className="mt-1.5">
          <MessageImages itemId={item.id} images={item.attachments} actions={actions} align="end" />
        </div>
      )}
      {!!item.files?.length && (
        <span className="mt-1 flex max-w-full items-center gap-1 text-meta text-fg-muted">
          <FileText size={14} className="shrink-0" />
          <span className="truncate">{item.files.map(f => f.name).join('、')}</span>
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
  actions,
}: {
  items: Item[]
  running: boolean
  waiting: boolean
  more(id: string): ReactNode
  actions: TurnActions
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
            <Step key={item.id} item={item} more={more(item.id)} actions={actions} />
          ))}
        </div>
      )}
    </div>
  )
}

function Step({ item, more, actions }: { item: Item; more: ReactNode; actions: TurnActions }) {
  const [open, setOpen] = useState(false)
  const body =
    item.kind === 'command' ? (
      <>
        <pre className="px-3 pt-2 font-mono text-label break-all whitespace-pre-wrap text-fg">$ {item.command}</pre>
        <Pre text={item.output} />
      </>
    ) : item.kind === 'tool' ? (
      <>
        <Pre text={item.output} />
        {!!item.images?.length && (
          <div className="px-3 pb-2">
            <MessageImages itemId={item.id} images={item.images} actions={actions} />
          </div>
        )}
      </>
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

function Output({
  item,
  more,
  copy,
  actions,
}: {
  item: Item
  more: ReactNode
  /** 下面放「复制」 */
  copy: boolean
  actions: TurnActions
}) {
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
          {copy && <CopyButton text={item.text} label="复制回复" className="mt-0.5 -ml-2" />}
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
          <span className="min-w-0 flex-1 break-words">
            {item.text}
            {item.id === actions.retryId && (
              <span className="mt-2 flex">
                <Button size="sm" disabled={actions.retrying} onClick={actions.retry}>
                  {actions.retrying ? <Spinner size={12} /> : <RotateCcw size={14} />} 重试
                </Button>
              </span>
            )}
          </span>
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
