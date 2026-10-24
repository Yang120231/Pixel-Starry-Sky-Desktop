// 「?」打开的键盘快捷键表（docs/mobile-remote.md §25）
import { isMac, shortcutList } from '@/platform/keys'
import { Kbd } from '@/ui'
import { Sheet } from '@/ui/sheet'
import { L } from '@/i18n'

export function ShortcutSheet({ onClose }: { onClose(): void }) {
  return (
    <Sheet title={L('键盘快捷键', 'Keyboard shortcuts')} onClose={onClose}>
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 px-4 py-4 text-ui">
        {shortcutList(isMac()).map(s => (
          <div key={s.label} className="contents">
            <dt className="text-fg-secondary">{s.label}</dt>
            <dd className="flex items-center justify-end gap-1">
              {s.keys.map(k => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  )
}
