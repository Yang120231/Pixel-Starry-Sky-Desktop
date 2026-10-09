import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { DEFAULT_COMPOSER_WIDTH, setLayoutSize, useLayoutSize } from '@/layout/sizes'

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
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const max = Math.min(2400, available)
  const min = Math.min(320, max)
  const width = Math.max(min, Math.min(preferredWidth, max))
  return <div ref={container} className="conversation-inset shrink-0 pb-3">
    <div className="composer-area relative mx-auto min-w-0 max-w-full" style={{ width }}>
      {children}
      {(['left', 'right'] as const).map(side => <ResizeHandle key={side} label={side === 'left' ? tr("session.ComposerArea.message121") : tr("session.ComposerArea.message122")} axis="x"
        className={`composer-resize-${side}`} scale={side === 'left' ? -2 : 2} value={width} min={min} max={max}
        onChange={v => setLayoutSize('composer', v)} onCommit={v => setLayoutSize('composer', v, true)}
        onCancel={() => setLayoutSize('composer', preferredWidth, true)}
        onReset={() => setLayoutSize('composer', DEFAULT_COMPOSER_WIDTH, true)} />)}
    </div>
  </div>
}
