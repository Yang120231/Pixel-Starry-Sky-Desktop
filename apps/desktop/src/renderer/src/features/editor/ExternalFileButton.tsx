import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useState } from 'react'
import { CodeXml } from 'lucide-react'
import { IconButton, Popover, PopoverItem } from '@/ui'
import { isDemo } from '@/data'
import { refreshEditors, setEditors, useEditors } from './store'
import { EditorIcon, editorLabel } from './EditorIcon'
import { updateFile, type OpenFile } from '@/features/files/store'

export function ExternalFileButton({ tab }: { tab: OpenFile }) {
  useI18n()
  const editors = useEditors(),
    [menu, setMenu] = useState(false),
    [busy, setBusy] = useState(false)
  const launch = async (id?: string): Promise<void> => {
    if (isDemo) {
      updateFile(tab.id, {
        get error() {
          return tr('editor.EditorButton.demoModeCannotOpen')
        },
      })
      return
    }
    setBusy(true)
    try {
      if (id) setEditors(await window.pixelsky!.editor.preferences({ defaultId: id }))
      await window.pixelsky!.editor.open(tab.ref, id, tab.path, tab.cursor.line, tab.cursor.column)
      setMenu(false)
    } catch (e) {
      updateFile(tab.id, { error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="relative shrink-0">
      <IconButton
        icon={CodeXml}
        size={28}
        iconSize={15}
        label={tr('editor.ExternalFileButton.openFileInExternal')}
        disabled={busy}
        onClick={() => {
          if (editors?.items.some(e => e.id === editors.defaultId && e.available)) void launch()
          else {
            setMenu(true)
            void refreshEditors().catch(e => updateFile(tab.id, { error: e.message }))
          }
        }}
      />
      <Popover open={menu} onClose={() => setMenu(false)} align="end" className="max-h-64 w-72 overflow-auto">
        {editors?.items
          .filter(e => e.available)
          .map(item => (
            <PopoverItem key={item.id} icon={<EditorIcon item={item} />} onClick={() => void launch(item.id)}>
              {editorLabel(item)}
            </PopoverItem>
          ))}
        {!editors?.items.some(e => e.available) && (
          <p className="p-3 text-meta text-fg-muted">{tr('editor.ExternalFileButton.noEditorDetectedSpecify')}</p>
        )}
      </Popover>
    </span>
  )
}
