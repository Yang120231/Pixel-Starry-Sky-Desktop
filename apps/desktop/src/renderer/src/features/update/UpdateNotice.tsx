// 侧栏底部的新版本提示（docs/release-update.md §7）：安装版下好后「重启以更新」，便携版「去下载」；点「稍后」本次运行不再显示
import { useState } from 'react'
import { ArrowDownToLine, RotateCw, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Button } from '@/ui'
import { updateActions, useUpdateState } from './store'

export function UpdateNotice() {
  useI18n()
  const update = useUpdateState()
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!update || (update.status !== 'ready' && update.status !== 'available') || !update.version) return null
  if (dismissed === update.version) return null
  const ready = update.status === 'ready'
  return (
    <div
      data-update-notice
      role="status"
      className="mx-1 mb-2 rounded-lg border border-line-card bg-surface px-3 py-2.5 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-ui font-medium text-fg">
          {tr(ready ? 'update.readyTitle' : 'update.availableTitle', { p0: update.version })}
        </p>
        <button
          type="button"
          aria-label={tr('update.later')}
          title={tr('update.later')}
          onClick={() => setDismissed(update.version ?? null)}
          className="press no-drag -mt-0.5 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <p className="mt-0.5 text-meta text-fg-muted">{tr(ready ? 'update.readyHint' : 'update.portableHint')}</p>
      <Button
        variant="primary"
        icon={ready ? RotateCw : ArrowDownToLine}
        className="mt-2 h-7 w-full px-2 text-meta"
        onClick={() => void (ready ? updateActions.install() : updateActions.download())}
      >
        {tr(ready ? 'update.restart' : 'update.download')}
      </Button>
    </div>
  )
}
