import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
// 消息下方的操作：我方消息「复制 / 回退」，助手回复「复制」（docs/ui/chat-fixes-queue-actions-cost.md §2）
import { createContext, useContext, useState } from 'react'
import { Undo2 } from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { CopyButton, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'

type UserItem = Extract<Item, { kind: 'user' }>

/** 由会话视图提供：能不能回退、为什么不能、执行回退 */
export interface MessageActionsValue {
  rewindDisabledReason: string | null
  rewind(item: UserItem): Promise<void>
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

export function UserMessageActions({ item }: { item: UserItem }) {
  useI18n()
  const actions = useContext(MessageActionsContext)
  const [confirming, setConfirming] = useState(false)
  const [skip, setSkip] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (item.mode === 'guidance') return null
  const reason = actions?.rewindDisabledReason ?? null
  const run = async (): Promise<boolean> => {
    if (!actions) return false
    setBusy(true)
    setError(null)
    try {
      await actions.rewind(item)
      return true
    } catch (err) {
      setError(translateMessage((err as Error).message))
      return false
    } finally {
      setBusy(false)
    }
  }
  const start = (): void => {
    if (skipConfirm()) {
      void run()
      return
    }
    setSkip(false)
    setError(null)
    setConfirming(true)
  }
  return (
    <>
      <div className={cn(ROW, 'shrink-0 pb-1', (confirming || error) && 'opacity-100')}>
        {error && !confirming && (
          <span role="alert" className="mr-1 text-meta text-danger">
            {error}
          </span>
        )}
        {item.text && <CopyButton text={item.text} label={tr('session.message.copy')} iconOnly />}
        {actions && (
          <button
            type="button"
            disabled={!!reason || busy}
            onClick={start}
            aria-label={tr('session.message.rewind')}
            title={reason ?? tr('session.message.rewindHint')}
            className="press no-drag inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            <Undo2 size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title={tr('session.message.rewindTitle')}
          description={
            <div className="flex flex-col gap-3">
              <p>{tr('session.message.rewindDesc')}</p>
              <label className="flex items-center gap-2 text-meta text-fg-muted">
                <input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} />
                {tr('session.message.rewindSkip')}
              </label>
            </div>
          }
          confirmLabel={tr('session.message.rewindConfirm')}
          cancelLabel={tr('session.message.cancel')}
          danger
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirming(false)
            setError(null)
          }}
          onConfirm={() =>
            void run().then(ok => {
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

export function AssistantMessageActions({ text }: { text: string }) {
  useI18n()
  if (!text.trim()) return null
  return (
    <span className="-ml-1 inline-flex">
      <CopyButton text={text} label={tr('session.message.copyReply')} iconOnly />
    </span>
  )
}
