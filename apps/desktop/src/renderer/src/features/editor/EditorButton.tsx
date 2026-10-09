import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useState } from 'react'
import { CodeXml } from 'lucide-react'
import { IconButton } from '@/ui'
import { useSettings } from '@/features/settings/SettingsProvider'
import { isDemo } from '@/data'
import { useActiveWorkspace } from './target'
import { refreshEditors, useEditors } from './store'
import { getFiles, showFiles } from '@/features/files/store'
import { paneActions } from '@/features/panes/store'

/** 顶栏只执行已选打开方式；选择和管理编辑器集中在设置页。 */
export function EditorButton({
  filesOpen = false,
  onCloseFiles,
  messageAbove = false,
}: {
  filesOpen?: boolean
  onCloseFiles?: () => void
  messageAbove?: boolean
}) {
  useI18n()
  const target = useActiveWorkspace(),
    editors = useEditors(),
    settings = useSettings()
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  useEffect(() => {
    void refreshEditors().catch(e => setMessage(e.message))
  }, [])
  useEffect(() => {
    setMessage('')
  }, [target.key])
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(''), 5000)
    return () => clearTimeout(timer)
  }, [message])

  const inside = !editors || editors.openWith === 'app'
  const primary = editors?.items.find(e => e.id === editors.openWith)
  const unavailable = !inside && !primary?.available
  const title = unavailable
    ? tr('editor.EditorButton.message450')
    : inside
      ? filesOpen
        ? tr('editor.EditorButton.message435')
        : tr('editor.EditorButton.message436')
      : tr('editor.EditorButton.message437', { p0: primary?.name ?? '' })

  const open = async (): Promise<void> => {
    if (busy) return
    if (unavailable) {
      settings.openSettings('editor')
      return
    }
    if (inside) {
      if (filesOpen && onCloseFiles) {
        onCloseFiles()
        return
      }
      if (!target.ref) return
      const file = getFiles().tabs.find(
        t => t.root.replaceAll('\\', '/').toLowerCase() === target.path.replaceAll('\\', '/').toLowerCase(),
      )
      if (file) paneActions.openFileTab(file.id)
      showFiles(target.ref)
      return
    }
    if (!target.ref || !primary) return
    if (isDemo) {
      setMessage(tr('editor.EditorButton.message432'))
      return
    }
    setBusy(true)
    try {
      const result = await window.pixelsky!.editor.open(target.ref, primary.id)
      setMessage(tr('editor.EditorButton.message433', { p0: result.editor }))
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="no-drag relative inline-flex h-8 shrink-0 items-center">
      <IconButton
        icon={CodeXml}
        size={32}
        iconSize={16}
        label={unavailable || target.ref || (inside && filesOpen) ? title : tr('editor.EditorButton.message439')}
        active={inside && filesOpen}
        aria-pressed={inside ? filesOpen : undefined}
        disabled={busy || (!target.ref && !filesOpen && !unavailable)}
        onClick={() => void open().catch(error => setMessage((error as Error).message))}
      />
      {message && (
        <div
          role="status"
          className={`absolute left-0 z-50 w-64 ${messageAbove ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-lg border border-line-card bg-popover p-3 text-meta text-fg shadow-menu`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
