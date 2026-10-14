import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { RefObject } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { scrollTabStrip } from './tabScroll'

/**
 * 标签栏两头的翻页箭头（docs/ui/multi-pane.md §12）：放在 .tab-strip-wrap 里、滚动层后面，
 * 显隐纯靠 CSS（滚动层有 data-fade-left / data-fade-right 时才显示），不触发重渲染
 */
export function TabStripArrows({ strip }: { strip: RefObject<HTMLElement | null> }) {
  useI18n()
  return (
    <>
      {(['left', 'right'] as const).map(side => {
        const label = tr(side === 'left' ? 'tabMenu.scrollLeft' : 'tabMenu.scrollRight')
        return (
          <button
            key={side}
            type="button"
            tabIndex={-1}
            data-tab-scroll={side}
            aria-label={label}
            title={label}
            onClick={() => strip.current && scrollTabStrip(strip.current, side === 'left' ? -1 : 1)}
          >
            {side === 'left' ? (
              <ChevronLeft size={14} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} />
            )}
          </button>
        )
      })}
    </>
  )
}
