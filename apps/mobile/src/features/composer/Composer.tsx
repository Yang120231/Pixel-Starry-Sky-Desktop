// 输入框：运行中发的消息由电脑排队（docs/ui/message-queue.md）。图片附件 M3 先不做（单帧 1 MB，要先压缩）。
import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import type { DesktopLink } from '@/connection'
import { Spinner, cn } from '@/ui'

export function Composer({
  link,
  sessionId,
  canAct,
  running,
}: {
  link: DesktopLink | undefined
  sessionId: string
  canAct: boolean
  running: boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = canAct && !!text.trim() && !busy
  const send = async () => {
    const value = text.trim()
    if (!link || !value) return
    setBusy(true)
    setError(null)
    try {
      await link.call('engine:send', sessionId, { text: value, clientMessageId: crypto.randomUUID() })
      setText('')
    } catch (e) {
      setError((e as Error).message === 'MOBILE_FORBIDDEN' ? '这部手机是「只看」。' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="border-t border-line-subtle px-3 pt-2 pb-2">
      {error && <p className="px-1 pb-1.5 text-meta text-danger">{error}</p>}
      <div className="flex items-end gap-2 rounded-3xl border border-line-composer bg-surface py-1.5 pr-1.5 pl-4 shadow-composer focus-within:border-line-composer-focus">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={1}
          disabled={!canAct}
          enterKeyHint="send"
          placeholder={!canAct ? '连接后才能发消息' : running ? '补充说明（会排在后面）…' : '回复…'}
          className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-prose text-fg outline-none placeholder:text-fg-faint"
        />
        <button
          type="button"
          aria-label="发送"
          disabled={!ready}
          onClick={() => void send()}
          className={cn(
            'mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors',
            ready ? 'bg-primary text-primary-fg' : 'bg-subtle text-fg-faint',
          )}
        >
          {busy ? <Spinner size={14} /> : <ArrowUp size={18} strokeWidth={2.25} />}
        </button>
      </div>
    </div>
  )
}
