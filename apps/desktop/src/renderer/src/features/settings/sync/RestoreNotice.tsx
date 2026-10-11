import { useEffect } from 'react'
import { CloudDownload, X } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { Button } from '@/ui'
import { dismissRestore, startSettingsSync, undoRestore, useSyncStatus } from './engine'

/**
 * 窗口级挂载一次：启动设置云同步；第一次同步用云端的覆盖了本机时，右下角提示一次「已从云端恢复设置」，
 * 带「撤销」（docs/ui/settings-sync.md §4），15 秒后自己消失。
 */
export function SettingsSyncRunner() {
  useI18n()
  const { restored } = useSyncStatus()
  useEffect(() => startSettingsSync(), [])
  useEffect(() => {
    if (!restored) return
    const t = setTimeout(dismissRestore, 15_000)
    return () => clearTimeout(t)
  }, [restored])
  if (!restored) return null
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-line bg-popover px-3.5 py-2.5 text-meta text-fg shadow-popover"
    >
      <CloudDownload size={16} className="shrink-0 text-accent-fg" />
      <span className="min-w-0 flex-1">{tr('settings.sync.restored')}</span>
      <Button variant="outline" className="h-7 shrink-0 px-2.5 text-meta" onClick={() => void undoRestore()}>
        {tr('settings.sync.undo')}
      </Button>
      <button
        type="button"
        aria-label={tr('settings.sync.close')}
        className="shrink-0 rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
        onClick={dismissRestore}
      >
        <X size={14} />
      </button>
    </div>
  )
}
