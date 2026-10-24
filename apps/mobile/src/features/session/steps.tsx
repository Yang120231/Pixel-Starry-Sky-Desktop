// 对话页里「过程」和「改动」用到的小件：一步（Step）、改动卡片、待办卡片、消息里的图片。
// ItemView（聊天流）和 ProcessSheet（点开「做了 N 步」）共用。
import { useState, type ReactNode } from 'react'
import { Brain, Check, ChevronRight, FileDiff, ListTodo, SquareTerminal, Wrench } from 'lucide-react'
import type { ImageAttachment, Item } from '@pixelsky/protocol'
import { imageError, imageKey, knownImage } from '@/data/images'
import { stepTitle } from '@/data/turns'
import { L } from '@/i18n'
import { DiffView, Spinner, cn } from '@/ui'
import { ImageTiles } from '@/ui/images'

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

/** 消息里的图片：有的直接显示，没有的显示尺寸，点了向电脑取 */
export function MessageImages({
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
          label: img.width && img.height ? `${img.width}×${img.height}` : L('图片', 'Image'),
          loading: loading === i,
        }))}
      />
      {error && <span className="text-label text-danger">{error}</span>}
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

export const failed = (item: Item) =>
  item.kind === 'command' ? item.status === 'failed' || !!item.exitCode : 'status' in item && item.status === 'failed'

export function Step({ item, more, actions }: { item: Item; more: ReactNode; actions: TurnActions }) {
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
          <span className="text-label text-danger">
            {L('退出码', 'Exit code')} {item.exitCode}
          </span>
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

export function Pre({ text }: { text: string }) {
  if (!text) return <p className="px-3 py-2 text-meta text-fg-muted">{L('没有输出', 'No output')}</p>
  return (
    <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-label break-all whitespace-pre-wrap text-fg-secondary">
      {text}
    </pre>
  )
}

/** 待办：一张卡片，每步一行 */
export function TodoCard({ item }: { item: Extract<Item, { kind: 'todo' }> }) {
  return (
    <div className="rounded-2xl border border-line-subtle bg-surface px-3.5 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-meta font-medium text-fg-muted">
        <ListTodo size={15} /> {L('计划', 'Plan')} · {item.steps.filter(s => s.status === 'completed').length}/
        {item.steps.length}
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
}

/** 改动文件：一张卡片，每个文件一行，点开看 diff */
export function Changes({ item, more }: { item: Extract<Item, { kind: 'file_change' }>; more: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const added = item.changes.reduce((n, c) => n + c.added, 0)
  const removed = item.changes.reduce((n, c) => n + c.removed, 0)
  return (
    <div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface">
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-1 text-meta text-fg-muted">
        <FileDiff size={15} />
        {L(
          `改动了 ${item.changes.length} 个文件`,
          item.changes.length === 1 ? 'Changed 1 file' : `Changed ${item.changes.length} files`,
        )}
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
                  {c.kind === 'add' && <span className="ml-1.5 text-label text-success">{L('新建', 'New')}</span>}
                  {c.kind === 'delete' && <span className="ml-1.5 text-label text-danger">{L('删除', 'Deleted')}</span>}
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
