import { useState } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 完全放行时输入框上方的一条细提示：可隐藏本次提示，切走再切回完全放行时重新显示。
import { TriangleAlert } from 'lucide-react'
import { PERMISSION_INFO, type ComposerController } from '@/features/engine'
import { saferMode } from './fullAccess'

export function FullAccessStrip({
  live,
}: {
  live: Pick<ComposerController, 'started' | 'permissionModes' | 'defaultPermissionMode' | 'setPermissionMode'>
}) {
  useI18n()
  const [dismissed, setDismissed] = useState(false)
  const back = saferMode(live.defaultPermissionMode, live.permissionModes)
  // Composer 仅在完全放行时挂载此组件，切到其他模式后本次隐藏状态随之清除。
  if (dismissed) return null
  return (
    <div
      data-full-access-strip
      className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-warn/35 bg-warn/8 px-3 py-1.5 text-meta text-fg-secondary"
    >
      <TriangleAlert size={14} className="shrink-0 text-warn" />
      <span className="min-w-0 flex-1 truncate">{tr(live.started ? 'fullAccess.strip' : 'fullAccess.stripNew')}</span>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md px-1.5 py-0.5 text-fg-secondary hover:bg-hover"
        >
          {tr('fullAccess.dismissStrip')}
        </button>
        <button
          type="button"
          onClick={() => live.setPermissionMode(back)}
          className="rounded-md px-1.5 py-0.5 text-accent-fg hover:bg-hover"
        >
          {tr('fullAccess.revert', { p0: PERMISSION_INFO[back].label })}
        </button>
      </div>
    </div>
  )
}
