import { translateMessage } from '../../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { useState } from 'react'
import { Check, RotateCw } from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { bridge } from '@/features/engine'
import { fullImages } from '../attachments/imageSource'

type UserItem = Extract<Item, { kind: 'user' }>

/** 断线后宿主自动发的「继续」：一行小字，接上了写「已重连 · 断开 n 次」 */
export function ReconnectLine({ attempt, failed }: { attempt: number; failed: boolean }) {
  useI18n()
  return (
    <div data-reconnect-line className="flex items-center gap-1.5 px-0.5 text-label text-fg-faint tabular-nums">
      {failed ? (
        <>
          <RotateCw size={12} strokeWidth={1.75} className="shrink-0" />
          {tr('session.reconnect.tried', { p0: attempt })}
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1 text-success">
            <Check size={12} strokeWidth={2} className="shrink-0" />
            {tr('session.reconnect.done')}
          </span>
          · {tr('session.reconnect.dropped', { p0: attempt })}
        </>
      )}
    </div>
  )
}

/** 发送失败后点了「关掉」的消息：气泡下面一行「未送达 · 已关掉 · 重发」 */
export function DismissedNote({ item, sessionId }: { item: UserItem; sessionId?: string | null }) {
  useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resend = async (): Promise<void> => {
    if (!bridge || !sessionId || busy) return
    setBusy(true)
    setError(null)
    try {
      // 对话里的图片不带数据：重发前按需取原图（attachments/imageSource.ts）
      const attachments = item.attachments?.length ? await fullImages(item.attachments, sessionId, item.id) : []
      await bridge.send(sessionId, {
        text: item.text,
        clientMessageId: crypto.randomUUID(),
        ...(attachments.length ? { attachments } : {}),
        ...(item.files?.length ? { files: item.files } : {}),
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-dismissed-note className="mt-1 px-0.5 text-right text-label text-fg-faint">
      <span className="text-warn">{tr('session.queue.undelivered')}</span> · {tr('session.queue.dismissed')}
      {bridge && sessionId && (
        <>
          {' · '}
          <button
            type="button"
            data-dismissed-resend
            disabled={busy}
            onClick={() => void resend()}
            className="rounded text-fg-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
          >
            {tr('session.queue.resend')}
          </button>
        </>
      )}
      {error && <p className="mt-0.5 text-danger">{translateMessage(error)}</p>}
    </div>
  )
}
