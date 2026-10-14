import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 完全放行时输入框上方的一条细提示（docs/ui/full-access-confirm.md P3）：一直在，点「改回」切回新会话的默认，切走就消失
import { TriangleAlert } from 'lucide-react'
import { PERMISSION_INFO, type ComposerController } from '@/features/engine'
import { saferMode } from './fullAccess'

export function FullAccessStrip({
  live,
}: {
  live: Pick<ComposerController, 'started' | 'permissionModes' | 'defaultPermissionMode' | 'setPermissionMode'>
}) {
  useI18n()
  const back = saferMode(live.defaultPermissionMode, live.permissionModes)
  return (
    <div
      data-full-access-strip
      className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-warn/35 bg-warn/8 px-3 py-1.5 text-meta text-fg-secondary"
    >
      <TriangleAlert size={14} className="shrink-0 text-warn" />
      <span className="min-w-0 flex-1 truncate">{tr(live.started ? 'fullAccess.strip' : 'fullAccess.stripNew')}</span>
      <button
        type="button"
        onClick={() => live.setPermissionMode(back)}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-accent-fg hover:bg-hover"
      >
        {tr('fullAccess.revert', { p0: PERMISSION_INFO[back].label })}
      </button>
    </div>
  )
}
