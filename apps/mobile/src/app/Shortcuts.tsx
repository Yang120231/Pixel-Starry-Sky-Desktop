// 「?」打开的键盘快捷键表（docs/mobile-remote.md §25）：和别的面板一样，一行一项、行间一条细线，左边说明、右边键帽
import { isMac, shortcutList } from '@/platform/keys'
import { Kbd, cn } from '@/ui'
import { Sheet } from '@/ui/sheet'
import { L } from '@/i18n'

export function ShortcutSheet({ onClose }: { onClose(): void }) {
  return (
    <Sheet title={L('键盘快捷键', 'Keyboard shortcuts')} onClose={onClose}>
      <dl className="px-5 pt-1 pb-3 text-ui">
        {shortcutList(isMac()).map((s, i) => (
          <div
            key={s.label}
            className={cn('flex min-h-11 items-center justify-between gap-6', i > 0 && 'border-t border-line-subtle')}
          >
            <dt className="text-fg-secondary">{s.label}</dt>
            <dd className="flex shrink-0 items-center justify-end gap-1">
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
