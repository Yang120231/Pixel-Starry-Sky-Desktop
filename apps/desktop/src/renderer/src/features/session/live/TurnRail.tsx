// 轮次跳转条（docs/ui/turn-rail.md）：对话区左边或右边一条竖的刻度，每轮一个，点了跳到那一轮
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from '@/ui'
import { currentTurn, maxTicks, sampleTurns, type Turn } from './turnRailModel'

/** 刻度区最大高度占对话区的比例；上下箭头各占 22px */
const MAX_SHARE = 0.7
const ARROWS = 44

export function TurnRail({
  turns,
  scroller,
  side,
  onBeforeJump,
}: {
  turns: Turn[]
  scroller: RefObject<HTMLDivElement | null>
  side: 'left' | 'right'
  /** 跳转前：暂停「贴底跟随」，不然新内容会把视口拉回底部 */
  onBeforeJump: () => void
}) {
  useI18n()
  const [current, setCurrent] = useState(0)
  const [height, setHeight] = useState(0)
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null)
  const ticks = useRef<HTMLDivElement>(null)

  const elementOf = (id: string): HTMLElement | null =>
    scroller.current?.querySelector<HTMLElement>(`[data-search-item="${CSS.escape(id)}"]`) ?? null

  // 对话区高度 → 刻度区能用的高度
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = (): void => setHeight(Math.max(0, el.clientHeight * MAX_SHARE - ARROWS))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scroller])

  // 滚动时算当前轮（每帧最多一次）
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const update = (): void => {
      frame = 0
      const base = el.getBoundingClientRect().top - el.scrollTop
      const tops = turns.map(t => {
        const row = elementOf(t.id)
        return row ? row.getBoundingClientRect().top - base : Number.POSITIVE_INFINITY
      })
      // 滚到底时最后一轮可能很短、顶部还没到视口顶部：也算最后一轮
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      setCurrent(atBottom ? turns.length - 1 : currentTurn(tops, el.scrollTop))
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    // elementOf 只读 scroller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, turns])

  const jump = (index: number): void => {
    const el = scroller.current
    const turn = turns[index]
    const row = turn && elementOf(turn.id)
    if (!el || !row) return
    onBeforeJump()
    setCurrent(index)
    const targetTop = (): number => row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12
    // 上面没排版过的块高度是估的，滚到后才算出真实高度、把目标顶走：之后 0.8 秒内每帧对齐一次，用户自己滚动就停
    const settle = (): void => {
      const until = performance.now() + 800
      let stopped = false
      const stop = (): void => {
        stopped = true
      }
      el.addEventListener('wheel', stop, { once: true, passive: true })
      el.addEventListener('pointerdown', stop, { once: true })
      const step = (): void => {
        if (stopped) return
        const want = targetTop()
        if (Math.abs(want - el.scrollTop) > 2) el.scrollTop = want
        if (performance.now() < until) requestAnimationFrame(step)
        else {
          el.removeEventListener('wheel', stop)
          el.removeEventListener('pointerdown', stop)
        }
      }
      requestAnimationFrame(step)
    }
    const top = targetTop()
    // 离得远直接跳（平滑滚过一长段既慢，又要把沿途内容都排版一遍）
    if (Math.abs(top - el.scrollTop) > el.clientHeight * 3) {
      el.scrollTop = top
      settle()
      return
    }
    el.scrollTo({ top, behavior: 'smooth' })
    el.addEventListener('scrollend', settle, { once: true })
  }

  if (turns.length < 2) return null

  const shown = sampleTurns(turns.length, maxTicks(height), current)
  const gap = Math.min(10, Math.max(3, height / Math.max(1, shown.length)))
  // 抽样后当前轮所在的刻度
  const focusIndex = shown.includes(current) ? current : shown[0]

  const onKey = (e: KeyboardEvent, index: number): void => {
    const at = shown.indexOf(index)
    const move = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!move) return
    e.preventDefault()
    const next = shown[Math.min(shown.length - 1, Math.max(0, at + move))]
    ticks.current?.querySelector<HTMLButtonElement>(`[data-turn-index="${next}"]`)?.focus()
  }

  const arrow =
    'press flex h-[22px] w-5 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent'
  const hovered = hover ? turns[hover.index] : null

  return (
    <nav
      data-turn-rail={side}
      aria-label={tr('turnRail.label')}
      className={cn(
        'absolute top-1/2 z-10 flex -translate-y-1/2 flex-col items-center',
        side === 'right' ? 'right-[calc(var(--conversation-scrollbar-width)+2px)]' : 'left-0.5',
      )}
      onMouseLeave={() => setHover(null)}
    >
      <button
        type="button"
        aria-label={tr('turnRail.previous')}
        title={tr('turnRail.previous')}
        disabled={current <= 0}
        onClick={() => jump(current - 1)}
        className={arrow}
      >
        <ChevronUp size={13} strokeWidth={1.75} />
      </button>
      <div ref={ticks} className="relative flex w-5 flex-col">
        {shown.map(index => {
          const active = index === current
          return (
            <button
              key={turns[index].id}
              type="button"
              data-turn-index={index}
              tabIndex={index === focusIndex ? 0 : -1}
              aria-current={active ? 'true' : undefined}
              aria-label={`${tr('turnRail.turn', { n: turns[index].n })} ${turns[index].preview}`}
              onClick={() => jump(index)}
              onKeyDown={e => onKey(e, index)}
              onMouseEnter={e => setHover({ index, y: e.currentTarget.offsetTop + gap / 2 })}
              onFocus={e => setHover({ index, y: e.currentTarget.offsetTop + gap / 2 })}
              onBlur={() => setHover(null)}
              style={{ height: gap }}
              className={cn(
                'group/tick flex w-full items-center outline-none',
                side === 'right' ? 'justify-end' : 'justify-start',
              )}
            >
              <span
                className={cn(
                  'h-[2px] rounded-full transition-[width,background-color] duration-(--dur-fast)',
                  active ? 'w-3.5 bg-accent' : 'w-2 bg-line-strong group-hover/tick:w-3.5 group-hover/tick:bg-fg-muted',
                  'group-focus-visible/tick:w-3.5 group-focus-visible/tick:bg-fg',
                )}
              />
            </button>
          )
        })}
        {hovered && hover && (
          <div
            role="tooltip"
            data-turn-tooltip
            className={cn(
              'pointer-events-none absolute z-20 w-max max-w-[280px] -translate-y-1/2 rounded-lg border border-line-card bg-popover px-2.5 py-1.5 text-meta shadow-popover',
              side === 'right' ? 'right-full mr-2' : 'left-full ml-2',
            )}
            style={{ top: hover.y }}
          >
            <span className="mr-1.5 text-fg-muted tabular-nums">{tr('turnRail.turn', { n: hovered.n })}</span>
            <span className="text-fg">{hovered.preview || tr('turnRail.imageOnly')}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={tr('turnRail.next')}
        title={tr('turnRail.next')}
        disabled={current >= turns.length - 1}
        onClick={() => jump(current + 1)}
        className={arrow}
      >
        <ChevronDown size={13} strokeWidth={1.75} />
      </button>
    </nav>
  )
}
