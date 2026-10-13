// 崩溃后重新加载的提示（docs/ui/renderer-memory.md §3.1.4）：不自动消失，用户点掉；轻量模式下带「退出轻量模式」
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { initTerminalStore, terminalState } from '@/features/terminal/store'
import { Button } from '@/ui'
import { Toast } from '@/ui/Toast'
import { recovered } from './recovered'
import { leaveLightweight, useLightweight } from './lightweight'

export function RecoveredNotice() {
  useI18n()
  const lightweight = useLightweight()
  const [open, setOpen] = useState(recovered !== null)
  const [terminals, setTerminals] = useState(false)
  // 终端那句只在重新加载后终端列表里有记录时才显示
  useEffect(() => {
    if (!recovered) return
    let alive = true
    void initTerminalStore().then(() => alive && setTerminals(terminalState().terminals.length > 0))
    return () => {
      alive = false
    }
  }, [])
  if (!recovered || !open) return null
  const lines = [
    tr(recovered.reason === 'oom' ? 'recovery.notice.oom' : 'recovery.notice.other'),
    ...(terminals ? [tr('recovery.notice.terminals')] : []),
    ...(lightweight ? [tr('recovery.notice.lightweight')] : []),
  ]
  return (
    <Toast className="max-w-[560px] items-start">
      <div className="flex flex-col gap-1">
        {lines.map(line => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div className="flex shrink-0 gap-2">
        {lightweight && (
          <Button
            onClick={() => {
              leaveLightweight()
              setOpen(false)
            }}
          >
            {tr('recovery.notice.leave')}
          </Button>
        )}
        <Button variant="primary" onClick={() => setOpen(false)}>
          {tr('recovery.notice.ok')}
        </Button>
      </div>
    </Toast>
  )
}
