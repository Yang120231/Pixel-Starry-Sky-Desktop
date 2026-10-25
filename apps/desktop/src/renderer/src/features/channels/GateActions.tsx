import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { Button } from '@/ui'

/** 人工关卡的「通过 / 打回」：打回先写一句要改什么（主进程要求必填），流程卡和「需要你」共用 */
export function GateActions({
  disabled,
  onApprove,
  onReject,
}: {
  disabled?: boolean
  onApprove: () => void
  onReject: (note: string) => void
}) {
  useI18n()
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const small = 'h-7 px-2.5 text-meta'
  const send = () => note.trim() && onReject(note.trim())
  if (rejecting)
    return (
      <>
        <input
          autoFocus
          aria-label={tr('channels.flow.gate.note')}
          placeholder={tr('channels.flow.gate.note')}
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
            if (e.key === 'Escape') setRejecting(false)
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-meta text-fg outline-none focus:border-accent"
        />
        <Button variant="primary" className={small} disabled={disabled || !note.trim()} onClick={send}>
          {tr('channels.flow.gate.send')}
        </Button>
      </>
    )
  return (
    <>
      <Button variant="primary" className={small} disabled={disabled} onClick={onApprove}>
        {tr('channels.flow.gate.approve')}
      </Button>
      <Button className={small} disabled={disabled} onClick={() => setRejecting(true)}>
        {tr('channels.flow.gate.reject')}
      </Button>
    </>
  )
}
