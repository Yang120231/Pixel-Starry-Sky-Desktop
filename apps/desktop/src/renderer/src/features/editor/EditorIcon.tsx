import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { CodeXml } from 'lucide-react'
import type { EditorItem } from '../../../../shared/types/workspace'
export function EditorIcon({ item }: { item: EditorItem }) {
  useI18n()
  return item.icon ? (
    <img alt="" src={item.icon} className="size-4 shrink-0 object-contain" />
  ) : (
    <CodeXml size={16} className="shrink-0 text-fg-muted" />
  )
}
export const editorLabel = (item: EditorItem): string => [item.name, item.version].filter(Boolean).join(' ')
export const editorSource = (item: EditorItem): string =>
  ({
    get shortcut() {
      return tr('editor.EditorIcon.shortcut')
    },
    get location() {
      return tr('editor.EditorIcon.defaultLocation')
    },
    path: 'PATH',
    get manual() {
      return tr('editor.EditorIcon.manuallySpecified')
    },
  })[item.source ?? (item.manual ? 'manual' : 'location')]
