import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 完全放行时输入框上方的风险提示，隐藏状态在本机窗口间同步。
import { TriangleAlert } from 'lucide-react'
import { PERMISSION_INFO, type ComposerController } from '@/features/engine'
import { saferMode } from './fullAccess'
import { dismissFullAccessStrip, useFullAccessStripDismissed } from './fullAccessStripState'

export function FullAccessStrip({
  live,
}: {
  live: Pick<ComposerController, 'started' | 'permissionModes' | 'defaultPermissionMode' | 'setPermissionMode'>
}) {
  useI18n()
  const dismissed = useFullAccessStripDismissed()
  const back = saferMode(live.defaultPermissionMode, live.permissionModes)
  if (dismissed) return null
  return (
    <div
      data-full-access-strip
      className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-warn/35 bg-warn/8 px-3 py-1.5 text-meta text-fg-secondary"
    >
      <TriangleAlert size={14} className="shrink-0 text-warn" />
      <span data-full-access-text className="min-w-0 flex-1 truncate">
        {tr(live.started ? 'fullAccess.strip' : 'fullAccess.stripNew')}
      </span>
      <div data-full-access-actions className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={dismissFullAccessStrip}
          className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-fg-secondary hover:bg-hover"
        >
          {tr('fullAccess.dismissStrip')}
        </button>
        <button
          type="button"
          onClick={() => live.setPermissionMode(back)}
          className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-accent-fg hover:bg-hover"
        >
          {tr('fullAccess.revert', { p0: PERMISSION_INFO[back].label })}
        </button>
      </div>
    </div>
  )
}
