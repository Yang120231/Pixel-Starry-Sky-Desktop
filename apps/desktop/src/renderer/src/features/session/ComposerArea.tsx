import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ResizeHandle } from '@/ui/ResizeHandle'
import { settledResizeObserver } from '@/features/panes/motion'
import { DEFAULT_COMPOSER_WIDTH, setLayoutSize, useLayoutSize } from '@/features/layout/sizes'

/** 输入框卡片的圆角（rounded-2xl）：左右拖动条只画在两条竖边的直线部分，不伸进圆角 */
const CARD_RADIUS = 16

/** 欢迎页与会话底部共享宽度偏好；窄窗格仅限制实际显示，不覆盖保存值。 */
export function ComposerArea({ children }: { children: ReactNode }) {
  useI18n()
  const preferredWidth = useLayoutSize('composer')
  const container = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(DEFAULT_COMPOSER_WIDTH)
  useLayoutEffect(() => {
    const el = container.current
    if (!el) return
    const update = (): void => {
      const style = getComputedStyle(el)
      const width = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      if (width > 0) setAvailable(width)
    }
    update()
    const observer = settledResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // 左右拖动条对齐输入框卡片：上面的机器 / 分支一行、下面的工具行高度不定，按卡片实际位置算
  const area = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState<{ top: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const update = (): void => {
      const card = el.querySelector<HTMLElement>('.composer-card')
      if (!card) return setEdge(null)
      const a = el.getBoundingClientRect(),
        c = card.getBoundingClientRect()
      const next = { top: c.top - a.top + CARD_RADIUS, bottom: a.bottom - c.bottom + CARD_RADIUS }
      setEdge(prev => (prev && prev.top === next.top && prev.bottom === next.bottom ? prev : next))
    }
    update()
    const observer = settledResizeObserver(update)
    observer.observe(el)
    const card = el.querySelector<HTMLElement>('.composer-card')
    if (card) observer.observe(card)
    // 卡片换了（欢迎页 → 会话、附件行出现）时重新挂上
    const mutations = new MutationObserver(() => {
      const next = el.querySelector<HTMLElement>('.composer-card')
      if (next) observer.observe(next)
      update()
    })
    mutations.observe(el, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [])
  const max = Math.min(2400, available)
  const min = Math.min(320, max)
  const width = Math.max(min, Math.min(preferredWidth, max))
  return (
    <div ref={container} className="conversation-inset shrink-0 pb-3">
      <div ref={area} className="composer-area relative mx-auto min-w-0 max-w-full" style={{ width }}>
        {children}
        {(['left', 'right'] as const).map(side => (
          <ResizeHandle
            key={side}
            label={
              side === 'left'
                ? tr('session.ComposerArea.resizeLeftComposerEdge')
                : tr('session.ComposerArea.resizeRightComposerEdge')
            }
            axis="x"
            className={`composer-resize-${side}`}
            style={edge ?? undefined}
            scale={side === 'left' ? -2 : 2}
            value={width}
            min={min}
            max={max}
            onChange={v => setLayoutSize('composer', v)}
            onCommit={v => setLayoutSize('composer', v, true)}
            onCancel={() => setLayoutSize('composer', preferredWidth, true)}
            onReset={() => setLayoutSize('composer', DEFAULT_COMPOSER_WIDTH, true)}
          />
        ))}
      </div>
    </div>
  )
}
