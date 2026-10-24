import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
// 消息下方的操作：我方消息「复制 / 分叉 / 回退」，助手回复「复制」
// （docs/ui/chat-fixes-queue-actions-cost.md §2、docs/ui/rewind-fork-sidechat.md §1–§2）
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { GitBranch, Undo2 } from 'lucide-react'
import type { Item, RewindOptions, RewindPreview } from '@pixelsky/protocol'
import { CopyButton, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useMessageActionsPosition } from '@/features/settings/messageActions'

type UserItem = Extract<Item, { kind: 'user' }>

/** 由会话视图提供：能不能回退 / 分叉、为什么不能、执行 */
export interface MessageActionsValue {
  rewindDisabledReason: string | null
  /** 回退这条消息时能恢复代码：引擎自己能，或者有对话检查点（docs/ui/undo-changes.md） */
  rewindCode(item: UserItem): boolean
  rewindPreview(item: UserItem): Promise<RewindPreview>
  rewind(item: UserItem, options: RewindOptions): Promise<void>
  /** 引擎不支持分叉时为 null */
  fork: ((item: UserItem) => Promise<void>) | null
}

export const MessageActionsContext = createContext<MessageActionsValue | null>(null)

const SKIP_KEY = 'pixelsky.rewind-confirm-skip'
const skipConfirm = (): boolean => {
  try {
    return localStorage.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}

const ROW =
  'flex items-center gap-0.5 opacity-0 transition-opacity duration-(--dur-fast) group-hover/message:opacity-100 group-focus-within/message:opacity-100'
const ICON =
  'press no-drag inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40'

export type Choice = 'both' | 'conversation' | 'code'
const OPTIONS: Record<Choice, RewindOptions> = {
  both: { conversation: true, code: true },
  conversation: { conversation: true, code: false },
  code: { conversation: false, code: true },
}

export function UserMessageActions({ item }: { item: UserItem }) {
  useI18n()
  const actions = useContext(MessageActionsContext)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const position = useMessageActionsPosition()
  if (item.mode === 'guidance') return null
  const reason = actions?.rewindDisabledReason ?? null
  const run = async (task: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await task()
      return true
    } catch (err) {
      setError(translateMessage((err as Error).message))
      return false
    } finally {
      setBusy(false)
    }
  }
  const start = (): void => {
    if (!actions) return
    // 不能恢复代码的引擎，勾过「不再确认」就直接回退对话
    if (!actions.rewindCode(item) && skipConfirm()) {
      void run(() => actions.rewind(item, OPTIONS.conversation))
      return
    }
    setError(null)
    setConfirming(true)
  }
  return (
    <>
      {/* 左侧时和气泡底部对齐；下方时是气泡下面右对齐的一行（ItemRows 的 UserBubble 摆位置） */}
      <div className={cn(ROW, position === 'left' && 'shrink-0 pb-1', (confirming || error) && 'opacity-100')}>
        {error && !confirming && (
          <span role="alert" className="mr-1 text-meta text-danger">
            {error}
          </span>
        )}
        {item.text && <CopyButton text={item.text} label={tr('session.message.copy')} iconOnly />}
        {actions?.fork && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => actions.fork!(item))}
            aria-label={tr('fork.action')}
            title={tr('fork.hint')}
            className={ICON}
          >
            <GitBranch size={13} strokeWidth={1.5} />
          </button>
        )}
        {actions && (
          <button
            type="button"
            disabled={!!reason || busy}
            onClick={start}
            aria-label={tr('session.message.rewind')}
            title={reason ?? (actions.rewindCode(item) ? tr('rewind.hint') : tr('session.message.rewindHint'))}
            className={ICON}
          >
            <Undo2 size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {confirming && actions && (
        <RewindDialog
          item={item}
          actions={actions}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirming(false)
            setError(null)
          }}
          onConfirm={(choice, skip, paths) =>
            void run(() => actions.rewind(item, rewindOptions(choice, paths))).then(ok => {
              if (!ok) return
              if (skip) {
                try {
                  localStorage.setItem(SKIP_KEY, '1')
                } catch {
                  /* 本次已回退 */
                }
              }
              setConfirming(false)
            })
          }
        />
      )}
    </>
  )
}

/**
 * 选项 + 只还原哪些文件：paths 为 null 是全部；空数组（全取消勾选）时不动代码，「代码和对话」就只回退对话
 */
export function rewindOptions(choice: Choice, paths: string[] | null): RewindOptions {
  const base = OPTIONS[choice]
  if (!paths || !base.code) return base
  return paths.length ? { ...base, paths } : { ...base, code: false }
}

/** 自动换成「恢复代码和对话」后这么久不能点回退，免得点到没看清的选项 */
const SETTLE_MS = 700

/**
 * 回退确认：选「代码和对话 / 只对话 / 只代码」。代码在后台检查（GitHub #35）：只恢复对话不用等，
 * 查到有文件要还原、而且还没动过选项时，默认换成「恢复代码和对话」
 */
function RewindDialog({
  item,
  actions,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  item: UserItem
  actions: MessageActionsValue
  busy: boolean
  error: string | null
  onCancel: () => void
  /** paths：只还原这些（对话检查点能挑文件）；null 是全部 */
  onConfirm: (choice: Choice, skip: boolean, paths: string[] | null) => void
}) {
  useI18n()
  const rewindCode = actions.rewindCode(item)
  const [preview, setPreview] = useState<RewindPreview | null>(null)
  /** 取消勾选的文件（docs/ui/undo-changes.md §4） */
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set())
  const [choice, setChoice] = useState<Choice>('conversation')
  const [skip, setSkip] = useState(false)
  const touched = useRef(false)
  const [settling, setSettling] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // actions 和 item 每次快照更新都会换新对象；依赖它们会在对话框开着时重复检查、多起辅助进程，所以只经 ref 读最新值
  const actionsRef = useRef(actions)
  const itemRef = useRef(item)
  actionsRef.current = actions
  itemRef.current = item
  useEffect(() => {
    if (!rewindCode) return
    let alive = true
    actionsRef.current
      .rewindPreview(itemRef.current)
      .then(p => {
        if (!alive) return
        setPreview(p)
        if (p.code.ok && p.code.files.length > 0 && !touched.current) {
          setChoice('both')
          setSettling(true)
        }
      })
      .catch((err: Error) => alive && setPreview({ code: { ok: false, reason: 'failed', message: err.message } }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 有意只按消息 id 和能否恢复代码重跑
  }, [item.id, rewindCode])
  useEffect(() => {
    if (!settling) return
    const timer = setTimeout(() => setSettling(false), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [settling])
  // 检查了几秒
  useEffect(() => {
    if (preview || !rewindCode) return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [preview, rewindCode])

  // 不能恢复代码的引擎：保持原来的简单确认
  if (!rewindCode)
    return (
      <ConfirmDialog
        title={tr('session.message.rewindTitle')}
        description={
          <div className="flex flex-col gap-3">
            <p>{tr('session.message.rewindDesc')}</p>
            <SkipBox checked={skip} onChange={setSkip} label={tr('session.message.rewindSkip')} />
          </div>
        }
        confirmLabel={tr('session.message.rewindConfirm')}
        cancelLabel={tr('session.message.cancel')}
        danger
        busy={busy}
        error={error}
        onCancel={onCancel}
        onConfirm={() => onConfirm('conversation', skip, null)}
      />
    )

  const code = preview?.code
  const hasFiles = !!code && code.ok && code.files.length > 0
  const codeOptions = hasFiles
  // 对话检查点能只还原其中几个文件；Claude Code 自己的检查点只能全部还原
  const pickable = hasFiles && code.ok && code.checkpoint === true
  const chosen = pickable && code.ok ? code.files.filter(f => !unchecked.has(f)) : null
  return (
    <ConfirmDialog
      title={tr('rewind.title')}
      description={
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label={tr('rewind.title')} className="flex flex-col gap-1.5">
            {(['both', 'conversation', 'code'] as const).map(c => {
              const disabled = c !== 'conversation' && !codeOptions
              return (
                <label
                  key={c}
                  data-rewind-choice={c}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2',
                    choice === c ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover',
                    disabled && 'pointer-events-none opacity-45',
                  )}
                >
                  <input
                    type="radio"
                    name="rewind-choice"
                    className="mt-1"
                    checked={choice === c}
                    disabled={disabled}
                    onChange={() => {
                      touched.current = true
                      setChoice(c)
                    }}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('text-list', choice === c ? 'text-accent-fg' : 'text-fg')}>
                      {tr(`rewind.${c}`)}
                    </span>
                    <span className="text-meta text-fg-muted">{tr(`rewind.${c}Desc`)}</span>
                  </span>
                </label>
              )
            })}
          </div>
          <CodeSummary
            preview={preview}
            elapsed={elapsed}
            picker={
              pickable
                ? {
                    unchecked,
                    toggle: path =>
                      setUnchecked(current => {
                        const next = new Set(current)
                        if (!next.delete(path)) next.add(path)
                        return next
                      }),
                  }
                : null
            }
          />
          {choice === 'conversation' ? (
            <SkipBox checked={skip} onChange={setSkip} label={tr('rewind.skip')} />
          ) : (
            <p className="text-meta text-fg-muted">{tr('rewind.undoHint')}</p>
          )}
        </div>
      }
      confirmLabel={tr('rewind.confirm')}
      cancelLabel={tr('session.message.cancel')}
      danger
      busy={busy}
      error={error}
      confirmDisabled={
        settling || (choice !== 'conversation' && !preview) || (choice === 'code' && chosen?.length === 0)
      }
      onCancel={onCancel}
      onConfirm={() =>
        onConfirm(
          choice,
          choice === 'conversation' && skip,
          chosen && code?.ok && chosen.length < code.files.length ? chosen : null,
        )
      }
    />
  )
}

function CodeSummary({
  preview,
  elapsed,
  picker,
}: {
  preview: RewindPreview | null
  elapsed: number
  /** 能挑文件时：每个文件一个勾选框，全部列出 */
  picker: { unchecked: ReadonlySet<string>; toggle: (path: string) => void } | null
}) {
  useI18n()
  const box = 'rounded-lg border border-line-subtle bg-subtle px-3 py-2 text-meta'
  if (!preview)
    return (
      <div className={cn(box, 'flex flex-col gap-0.5 text-fg-muted')} data-rewind-code="checking">
        <span className="tabular-nums">
          {elapsed >= 1 ? tr('rewind.checkingFor', { n: elapsed }) : tr('rewind.checking')}
        </span>
        <span className="text-fg-faint">{tr('rewind.checkingNoWait')}</span>
      </div>
    )
  const code = preview.code
  if (!code.ok)
    return (
      <div className={cn(box, 'text-fg-muted')} data-rewind-code={code.reason}>
        {code.reason === 'compacted'
          ? tr('rewind.compacted')
          : code.reason === 'no-checkpoint'
            ? tr('rewind.noCheckpoint')
            : code.reason === 'unsupported'
              ? tr('rewind.unsupportedCode')
              : code.reason === 'expired'
                ? tr('branch.checkpointExpired')
                : tr('rewind.codeFailed', { reason: translateMessage(code.message ?? '') })}
      </div>
    )
  if (code.files.length === 0)
    return (
      <div className={cn(box, 'text-fg-muted')} data-rewind-code="unchanged">
        {tr('rewind.unchanged')}
      </div>
    )
  const shown = picker ? code.files : code.files.slice(0, 5)
  const edited = new Set(code.edited ?? [])
  const kept = picker ? code.files.filter(f => !picker.unchecked.has(f)).length : code.files.length
  return (
    <div className={cn(box, 'flex flex-col gap-1 text-fg-secondary')} data-rewind-code="files">
      <div className="flex items-center gap-2 text-fg">
        <span>
          {picker
            ? tr('checkpoint.restoreCount', { k: kept, n: code.files.length })
            : code.files.length === 1
              ? tr('rewind.filesOne')
              : tr('rewind.files', { n: code.files.length })}
        </span>
        <span className="tabular-nums">
          <span className="text-success">+{code.insertions}</span>{' '}
          <span className="text-danger">−{code.deletions}</span>
        </span>
      </div>
      <ul
        data-rewind-files
        className={cn('flex flex-col font-mono text-code-path', picker && 'max-h-40 overflow-y-auto')}
      >
        {shown.map(f =>
          picker ? (
            <li key={f}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
                <input type="checkbox" checked={!picker.unchecked.has(f)} onChange={() => picker.toggle(f)} />
                <span className="min-w-0 flex-1 truncate" title={f}>
                  {f}
                </span>
                {edited.has(f) && (
                  <span className="shrink-0 font-sans text-meta text-warn">{tr('checkpoint.edited')}</span>
                )}
              </label>
            </li>
          ) : (
            <li key={f} className="truncate" title={f}>
              {f}
            </li>
          ),
        )}
        {code.files.length > shown.length && (
          <li className="font-sans text-fg-muted">{tr('rewind.more', { n: code.files.length - shown.length })}</li>
        )}
      </ul>
      {code.edited?.length ? (
        <p className="text-warn">{tr('checkpoint.editedWarn', { n: code.edited.length })}</p>
      ) : (
        <p className="text-fg-muted">{tr('rewind.overwrite')}</p>
      )}
      {!code.undoable && <p className="text-warn">{tr('rewind.noUndo')}</p>}
    </div>
  )
}

function SkipBox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-meta text-fg-muted">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function AssistantMessageActions({ text }: { text: string }) {
  useI18n()
  if (!text.trim()) return null
  return (
    <span className="-ml-1 inline-flex">
      <CopyButton text={text} label={tr('session.message.copyReply')} iconOnly />
    </span>
  )
}
