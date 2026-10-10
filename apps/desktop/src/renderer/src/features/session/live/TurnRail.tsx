// 轮次跳转条（docs/ui/turn-rail.md）：对话区左边或右边一列短刻度，每轮一个；
// 鼠标移上去在旁边展开轮次列表（序号 + 第一行），点刻度或列表项跳到那一轮
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { cn } from '@/ui'
import { currentTurn, maxTicks, sampleTurns, type Turn } from './turnRailModel'

/** 刻度区最大高度占对话区的比例 */
const MAX_SHARE = 0.6
/** 展开 / 收起列表的延迟：从刻度移到列表的路上不闪 */
const OPEN_DELAY = 120
const CLOSE_DELAY = 220

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
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const elementOf = (id: string): HTMLElement | null =>
    scroller.current?.querySelector<HTMLElement>(`[data-search-item="${CSS.escape(id)}"]`) ?? null

  // 对话区高度 → 刻度区能用的高度
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = (): void => setHeight(Math.max(0, el.clientHeight * MAX_SHARE))
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

  const shown = sampleTurns(turns.length, maxTicks(height, 4), current)
  const gap = Math.min(8, Math.max(4, height / Math.max(1, shown.length)))

  const later = (next: boolean, delay: number): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), delay)
  }
  const go = (index: number): void => {
    jump(index)
    setOpen(false)
  }
  const onListKey = (e: KeyboardEvent): void => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-turn-item]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      scroller.current?.focus({ preventScroll: true })
      return
    }
    const move = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!move) return
    e.preventDefault()
    items[Math.min(items.length - 1, Math.max(0, at + move))]?.focus()
  }

  return (
    <nav
      data-turn-rail={side}
      aria-label={tr('turnRail.label')}
      className={cn(
        'absolute top-1/2 z-10 -translate-y-1/2',
        side === 'right' ? 'right-[calc(var(--conversation-scrollbar-width)+4px)]' : 'left-1',
      )}
      onMouseEnter={() => later(true, OPEN_DELAY)}
      onMouseLeave={() => later(false, CLOSE_DELAY)}
      onFocus={() => later(true, 0)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) later(false, 0)
      }}
    >
      {/* 刻度：一个可聚焦的入口，聚焦后在列表里用 ↑ / ↓ 选、回车跳 */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={tr('turnRail.label')}
        data-turn-ticks
        onKeyDown={e => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
          e.preventDefault()
          setOpen(true)
          requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[aria-current]')?.focus())
        }}
        className={cn(
          'group/rail flex w-6 flex-col rounded-md py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent',
          side === 'right' ? 'items-end pr-1' : 'items-start pl-1',
        )}
      >
        {shown.map(index => {
          const active = index === current
          return (
            <span
              key={turns[index].id}
              data-turn-index={index}
              aria-current={active ? 'true' : undefined}
              onClick={() => go(index)}
              style={{ height: gap }}
              className={cn(
                'flex w-full cursor-pointer items-center',
                side === 'right' ? 'justify-end' : 'justify-start',
              )}
            >
              <span
                className={cn(
                  'block h-[1.5px] rounded-full transition-[width,background-color,opacity] duration-(--dur-fast)',
                  active
                    ? 'w-4 bg-fg opacity-90'
                    : 'w-2 bg-fg-faint opacity-45 group-hover/rail:w-2.5 group-hover/rail:opacity-80',
                )}
              />
            </span>
          )
        })}
      </div>
      {open && (
        <div
          ref={list}
          role="menu"
          data-turn-list
          onKeyDown={onListKey}
          className={cn(
            'pop-in absolute top-1/2 flex max-h-[min(60vh,440px)] w-[280px] -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line-card bg-popover shadow-popover',
            side === 'right' ? 'right-full mr-1.5' : 'left-full ml-1.5',
          )}
        >
          <div className="flex shrink-0 items-center justify-between px-3 pt-2.5 pb-1.5 text-label text-fg-faint">
            <span>{tr('turnRail.label')}</span>
            <span className="tabular-nums">
              {current + 1} / {turns.length}
            </span>
          </div>
          <TurnList turns={turns} current={current} onPick={go} />
        </div>
      )}
    </nav>
  )
}

function TurnList({ turns, current, onPick }: { turns: Turn[]; current: number; onPick: (index: number) => void }) {
  useI18n()
  const box = useRef<HTMLDivElement>(null)
  // 打开时把当前轮滚到列表中间
  useLayoutEffect(() => {
    box.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div ref={box} className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
      {turns.map((t, i) => {
        const active = i === current
        return (
          <button
            key={t.id}
            type="button"
            role="menuitem"
            data-turn-item={i}
            aria-current={active ? 'true' : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onPick(i)}
            className={cn(
              'relative flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left text-meta outline-none hover:bg-hover focus-visible:bg-hover',
              active ? 'bg-hover text-fg' : 'text-fg-secondary',
            )}
          >
            {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-accent" />}
            <span className={cn('w-5 shrink-0 text-right tabular-nums', active ? 'text-accent-fg' : 'text-fg-faint')}>
              {t.n}
            </span>
            <span className="min-w-0 flex-1 truncate">{t.preview || tr('turnRail.imageOnly')}</span>
          </button>
        )
      })}
    </div>
  )
}
