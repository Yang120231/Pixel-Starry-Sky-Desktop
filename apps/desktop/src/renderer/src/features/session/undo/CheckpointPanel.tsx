// 检查点面板（docs/ui/undo-changes.md §4）：选一轮，挑要还原的文件，回到那一轮之前（代码和对话 / 只代码 / 只对话）
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { History, X } from 'lucide-react'
import type { Item, RewindOptions, RewindPreview, SessionSnapshot } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, IconButton, Popover, SEGMENT_TRACK, cn, segmentItem } from '@/ui'
import type { CheckpointsValue } from './checkpoints'

type UserItem = Extract<Item, { kind: 'user' }>
type Mode = 'both' | 'code' | 'conversation'
const MODES: Mode[] = ['both', 'code', 'conversation']

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const firstLine = (item: UserItem): string =>
  item.text.split('\n').find(l => l.trim()) ?? item.files?.[0]?.name ?? item.attachments?.[0]?.name ?? ''

export function CheckpointPanel({
  open,
  anchor,
  snapshot,
  checkpoints,
  canRewindConversation,
  engineRewindCode,
  preview,
  rewind,
  onClose,
}: {
  open: boolean
  anchor: RefObject<HTMLElement | null>
  snapshot: SessionSnapshot
  checkpoints: CheckpointsValue
  /** 引擎能回退对话 */
  canRewindConversation: boolean
  /** 没有对话检查点时，引擎自己能恢复代码（Claude Code 的文件检查点，一次还原全部） */
  engineRewindCode: boolean
  preview: (item: UserItem) => Promise<RewindPreview>
  rewind: (item: UserItem, options: RewindOptions) => Promise<void>
  onClose: () => void
}) {
  useI18n()
  const users = useMemo(
    // 断线重连自动发的「继续」不算一轮（接着原消息，对话里也不给它「回退」）
    () =>
      snapshot.items.filter(
        (i): i is UserItem => i.kind === 'user' && i.mode !== 'guidance' && i.reconnect === undefined,
      ),
    [snapshot.items],
  )
  const list = checkpoints.list
  // 每轮的快照按消息 id 查：长会话上千轮时逐行 find 是 n²；倒着建，同一条消息有两项时和 find 一样取第一项
  const turnOf = useMemo(() => new Map((list?.turns ?? []).toReversed().map(t => [t.itemId, t])), [list])
  const [selected, setSelected] = useState<string | null>(null)
  const item = users.length ? (users.find(u => u.id === selected) ?? users[users.length - 1]!) : null
  const turn = item ? turnOf.get(item.id) : undefined
  const itemIndex = item ? users.indexOf(item) : -1
  const codeAvailable = !!turn || engineRewindCode
  const [result, setResult] = useState<{ itemId: string; preview: RewindPreview } | null>(null)
  const code = result && item && result.itemId === item.id ? result.preview.code : null
  // 检查过、恢复不了代码（没有检查点、压缩之前等）：代码相关的两项也灰掉
  const codeUsable = codeAvailable && !(code && !code.ok)
  const allowed: Record<Mode, boolean> = {
    both: canRewindConversation && codeUsable,
    code: codeUsable,
    conversation: canRewindConversation,
  }
  const [mode, setMode] = useState<Mode>('both')
  const effective: Mode = allowed[mode] ? mode : (MODES.find(m => allowed[m]) ?? 'conversation')
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 打开时重新取一次：结束快照可能刚拍完
  const refresh = checkpoints.refresh
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])
  // 选中的一轮变了：重新检查要还原的文件
  const previewRef = useRef(preview)
  previewRef.current = preview
  const itemId = item?.id ?? null
  const wantsCode = open && codeAvailable && !!item
  useEffect(() => {
    setUnchecked(new Set())
    setError(null)
    if (!wantsCode || !item) return
    let alive = true
    setResult(null)
    previewRef
      .current(item)
      .then(p => alive && setResult({ itemId: item.id, preview: p }))
      .catch(
        (err: Error) =>
          alive &&
          setResult({ itemId: item.id, preview: { code: { ok: false, reason: 'failed', message: err.message } } }),
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按消息 id 重新检查，item 对象每次快照都换新
  }, [itemId, wantsCode])

  const files = code?.ok ? code.files : []
  const pickable = !!code?.ok && code.checkpoint === true
  const chosen = files.filter(f => !unchecked.has(f))
  const restoresCode = effective !== 'conversation'
  const removesConversation = effective !== 'code'
  const waiting = restoresCode && !code
  const nothingToDo = effective === 'code' && (!code?.ok || chosen.length === 0)
  const busyReason = checkpoints.busy ? tr('checkpoint.busy') : null

  const confirm = async (): Promise<void> => {
    if (!item) return
    const withCode = restoresCode && !!code?.ok && chosen.length > 0
    const options: RewindOptions = {
      conversation: removesConversation,
      code: withCode,
      ...(withCode && pickable && chosen.length < files.length ? { paths: chosen } : {}),
    }
    setBusy(true)
    setError(null)
    try {
      await rewind(item, options)
      onClose()
    } catch (err) {
      setError(translateMessage((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      side="top"
      align="end"
      offset={8}
      bare
      role="dialog"
      aria-label={tr('checkpoint.title')}
      className="flex max-h-[min(560px,70vh)] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden"
    >
      <div data-checkpoint-panel className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle pr-1.5 pl-3.5">
          <History size={15} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate text-list font-medium text-fg">{tr('checkpoint.title')}</span>
          {users.length > 0 && (
            <span className="shrink-0 text-meta text-fg-muted">{tr('checkpoint.turns', { n: users.length })}</span>
          )}
          <IconButton icon={X} label={tr('rewind.dismiss')} size={26} iconSize={14} onClick={onClose} />
        </div>
        {list?.disabled && (
          <p className="shrink-0 border-b border-line-subtle px-3.5 py-2 text-meta text-warn">
            {tr(`checkpoint.disabled.${list.disabled}`)}
          </p>
        )}
        {!item ? (
          <p className="px-3.5 py-6 text-center text-meta text-fg-muted">{tr('checkpoint.empty')}</p>
        ) : (
          <>
            <ol data-checkpoint-list className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {users.map((u, i) => {
                const t = turnOf.get(u.id)
                const active = u.id === item.id
                const after = i > itemIndex
                const meta = t
                  ? t.files === null
                    ? tr('checkpoint.pending')
                    : t.files.length === 0
                      ? tr('checkpoint.noFiles')
                      : t.files.length === 1
                        ? tr('checkpoint.filesOne')
                        : tr('checkpoint.filesN', { n: t.files.length })
                  : tr('checkpoint.noSnapshot')
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      data-checkpoint-turn={u.id}
                      aria-current={active || undefined}
                      onClick={() => setSelected(u.id)}
                      className={cn(
                        'press grid w-full grid-cols-[14px_1fr_auto] items-start gap-2 rounded-md px-2 py-1.5 text-left',
                        active ? 'bg-accent-soft' : 'hover:bg-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-2 rounded-full border-[1.5px]',
                          active ? 'border-accent bg-accent' : t ? 'border-accent-line' : 'border-fg-faint',
                        )}
                      />
                      <span className={cn('min-w-0', after && 'opacity-50')}>
                        <span className="block truncate text-list text-fg">
                          #{i + 1} {firstLine(u)}
                        </span>
                        <span className={cn('block text-meta', t ? 'text-fg-muted' : 'text-fg-faint')}>{meta}</span>
                      </span>
                      <span className="pt-0.5 text-meta text-fg-faint tabular-nums">{clock(u.createdAt)}</span>
                    </button>
                  </li>
                )
              })}
              <li className="grid grid-cols-[14px_1fr] items-center gap-2 px-2 py-1.5">
                <span className="size-2 rounded-full border-[1.5px] border-accent" />
                <span className="text-meta text-fg-muted">{tr('checkpoint.now')}</span>
              </li>
            </ol>
            <div className="flex shrink-0 flex-col gap-2 border-t border-line-subtle px-3.5 pt-2.5 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-list font-medium text-fg">
                  {tr('checkpoint.goBack', { n: users.indexOf(item) + 1 })}
                </span>
                <span className="flex-1" />
                <div role="radiogroup" aria-label={tr('checkpoint.title')} className={cn(SEGMENT_TRACK, 'h-7')}>
                  {MODES.map(m => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={effective === m}
                      disabled={!allowed[m]}
                      data-checkpoint-mode={m}
                      title={
                        allowed[m]
                          ? undefined
                          : m === 'conversation' || !canRewindConversation
                            ? tr('checkpoint.noConversation')
                            : tr('checkpoint.noCode')
                      }
                      onClick={() => setMode(m)}
                      className={cn(segmentItem(effective === m), 'px-2 text-meta disabled:opacity-40')}
                    >
                      {tr(`checkpoint.mode.${m}`)}
                    </button>
                  ))}
                </div>
              </div>
              {restoresCode && (
                <CodePart
                  code={code}
                  pickable={pickable}
                  chosen={chosen.length}
                  unchecked={unchecked}
                  onToggle={path =>
                    setUnchecked(current => {
                      const next = new Set(current)
                      if (!next.delete(path)) next.add(path)
                      return next
                    })
                  }
                />
              )}
              {/* 代码恢复不了：说明原因（检查结果里的原因更具体） */}
              {!restoresCode &&
                !codeUsable &&
                (code ? (
                  <CodePart code={code} pickable={false} chosen={0} unchecked={unchecked} onToggle={() => {}} />
                ) : (
                  <p className="text-meta text-fg-muted">{tr('checkpoint.noCode')}</p>
                ))}
              {removesConversation && (
                <p className="text-meta text-fg-muted">
                  {tr('checkpoint.removeTurns', {
                    n: users.length - users.indexOf(item),
                    k: users.indexOf(item) + 1,
                  })}
                </p>
              )}
              {error && (
                <p role="alert" className="text-meta text-danger">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-1.5">
                {busyReason && <span className="mr-auto text-meta text-fg-muted">{busyReason}</span>}
                <Button variant="ghost" className="h-7 px-3 text-meta" onClick={onClose}>
                  {tr('session.message.cancel')}
                </Button>
                <Button
                  variant="primary"
                  data-checkpoint-confirm
                  className="h-7 px-3 text-meta"
                  disabled={busy || !!busyReason || !allowed[effective] || waiting || nothingToDo}
                  onClick={() => void confirm()}
                >
                  {tr('checkpoint.confirm')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Popover>
  )
}

function CodePart({
  code,
  pickable,
  chosen,
  unchecked,
  onToggle,
}: {
  code: RewindPreview['code'] | null
  pickable: boolean
  chosen: number
  unchecked: ReadonlySet<string>
  onToggle: (path: string) => void
}) {
  useI18n()
  if (!code) return <p className="text-meta text-fg-muted">{tr('rewind.checking')}</p>
  if (!code.ok)
    return (
      <p className="text-meta text-fg-muted">
        {code.reason === 'no-checkpoint' || code.reason === 'unsupported'
          ? tr('checkpoint.noCode')
          : code.reason === 'compacted'
            ? tr('rewind.compacted')
            : code.reason === 'expired'
              ? tr('branch.checkpointExpired')
              : tr('rewind.codeFailed', { reason: translateMessage(code.message ?? '') })}
      </p>
    )
  if (code.files.length === 0) return <p className="text-meta text-fg-muted">{tr('checkpoint.unchanged')}</p>
  const edited = new Set(code.edited ?? [])
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta text-fg-muted">
        {pickable
          ? tr('checkpoint.restoreCount', { k: chosen, n: code.files.length })
          : tr('checkpoint.allFiles', { n: code.files.length })}
      </span>
      <ul data-checkpoint-files className="flex max-h-36 flex-col overflow-y-auto font-mono text-code-path">
        {code.files.map(f => (
          <li key={f}>
            <label
              className={cn(
                'flex items-center gap-2 rounded px-1 py-0.5',
                pickable ? 'cursor-pointer hover:bg-hover' : 'cursor-default',
              )}
            >
              {pickable && <input type="checkbox" checked={!unchecked.has(f)} onChange={() => onToggle(f)} />}
              <span className="min-w-0 flex-1 truncate text-fg-secondary" title={f}>
                {f}
              </span>
              {edited.has(f) && (
                <span className="shrink-0 font-sans text-meta text-warn">{tr('checkpoint.edited')}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {!pickable && <p className="text-meta text-fg-muted">{tr('checkpoint.engineAll')}</p>}
      {edited.size > 0 && <p className="text-meta text-warn">{tr('checkpoint.editedWarn', { n: edited.size })}</p>}
      {!code.undoable && <p className="text-meta text-warn">{tr('rewind.noUndo')}</p>}
    </div>
  )
}
