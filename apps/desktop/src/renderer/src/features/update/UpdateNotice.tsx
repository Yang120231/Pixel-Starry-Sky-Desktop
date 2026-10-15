// 新版本提示（docs/release-update.md §7）：对话模式在侧栏底部，代码模式浮在左下角；点「稍后」本次运行不再显示
import { ArrowDownToLine, RotateCw, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Button, cn } from '@/ui'
import { updateActions, useUpdateNoticeState } from './store'

export function UpdateNotice({ placement = 'sidebar' }: { placement?: 'sidebar' | 'floating' }) {
  useI18n()
  const update = useUpdateNoticeState()
  const version = update?.version
  if (!update || !version) return null
  const ready = update.status === 'ready'
  return (
    <div
      data-update-notice
      role="status"
      className={cn(
        'rounded-lg border border-line-card bg-surface px-3 py-2.5',
        placement === 'floating'
          ? 'absolute bottom-2 left-12 z-20 w-72 max-w-[calc(100%-96px)] shadow-menu'
          : 'mx-1 mb-2 shadow-sm',
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-ui font-medium text-fg">
          {tr(ready ? 'update.readyTitle' : 'update.availableTitle', { p0: update.version })}
        </p>
        <button
          type="button"
          aria-label={tr('update.later')}
          title={tr('update.later')}
          onClick={() => updateActions.dismissNotice(version)}
          className="press no-drag -mt-0.5 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <p className="mt-0.5 text-meta text-fg-muted">
        {tr(ready ? 'update.readyHint' : update.channel === 'portable' ? 'update.portableHint' : 'update.manualHint')}
      </p>
      <Button
        variant="primary"
        icon={ready ? RotateCw : ArrowDownToLine}
        className="mt-2 h-7 w-full px-2 text-meta"
        disabled={update.installing}
        onClick={() => void (ready ? updateActions.install() : updateActions.download())}
      >
        {tr(ready ? (update.installing ? 'update.restarting' : 'update.restart') : 'update.download')}
      </Button>
    </div>
  )
}
