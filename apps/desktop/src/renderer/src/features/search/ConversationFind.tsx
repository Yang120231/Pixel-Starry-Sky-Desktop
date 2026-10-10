import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 对话内搜索（Ctrl+F，docs/ui/content-highlight.md §2 E）：浮在对话区右上角，按字面不分大小写查找已经显示的文字，
// 用 termMarks 标出全部命中和当前这个，新内容到达时自动更新。
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { searchLiteral } from '@pixelsky/protocol'
import { IconButton } from '@/ui'
import { FIND_IN_CONVERSATION } from '@/features/layout/shortcuts'
import { findRanges, setMarks } from './termMarks'

/** 最近点过 / 聚焦过的对话区：焦点不在任何输入框时，Ctrl+F 打开在它上面 */
let lastConversation: HTMLElement | null = null

const isHidden = (el: HTMLElement): boolean =>
  el.getClientRects().length === 0 || !!el.closest('[inert],[aria-hidden="true"]')

/**
 * 给一个对话区（main）挂 Ctrl+F：事件发生在这个对话区里，或者焦点不在任何地方而它是最近用过的对话区时打开。
 * 终端、编辑器、设置里的 Ctrl+F 事件不在对话区里，不受影响。
 */
export function useFindShortcut(main: RefObject<HTMLElement | null>, enabled: boolean, onFind: () => void): void {
  const latest = useRef(onFind)
  latest.current = onFind
  useEffect(() => {
    if (!enabled) return
    const remember = (e: Event): void => {
      const el = main.current
      if (el && e.target instanceof Node && el.contains(e.target)) lastConversation = el
    }
    const onKey = (e: KeyboardEvent): void => {
      const el = main.current
      if (!el || !FIND_IN_CONVERSATION.match(e) || isHidden(el)) return
      const target = e.target instanceof Node ? e.target : null
      const idle = !target || target === document.body || target === document.documentElement
      const fallback = lastConversation?.isConnected
        ? lastConversation
        : document.querySelector('main.conversation-view')
      if (!(target && el.contains(target)) && !(idle && fallback === el)) return
      e.preventDefault()
      latest.current()
    }
    window.addEventListener('pointerdown', remember, true)
    window.addEventListener('focusin', remember, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', remember, true)
      window.removeEventListener('focusin', remember, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [main, enabled])
}

/** 把一个命中滚到对话区中间（已经看得见时不动） */
function reveal(range: Range, scroller: HTMLElement): void {
  const rect = range.getBoundingClientRect(),
    box = scroller.getBoundingClientRect()
  if (rect.top >= box.top + 32 && rect.bottom <= box.bottom - 32) return
  scroller.scrollTop += rect.top - box.top - (scroller.clientHeight - rect.height) / 2
}

export function ConversationFind({
  root,
  focusToken,
  onClose,
}: {
  /** 对话流（[data-conversation-stream]）所在的区域 */
  root: RefObject<HTMLElement | null>
  /** 每次按 Ctrl+F 加一：已经打开时重新聚焦并全选 */
  focusToken: number
  onClose: () => void
}) {
  useI18n()
  const owner = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Range[]>([])
  const [index, setIndex] = useState(0)
  // 查询变了要滚到第一个；内容更新引起的重算不滚动
  const pendingReveal = useRef(false)

  const stream = useCallback(
    (): HTMLElement | null => root.current?.querySelector<HTMLElement>('[data-conversation-stream]') ?? null,
    [root],
  )

  useLayoutEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusToken])

  // 查询变了：稍等再查（连续打字时不每个字都扫一遍）
  useEffect(() => {
    const term = searchLiteral(query)
    const timer = window.setTimeout(() => {
      const el = stream()
      pendingReveal.current = true
      setIndex(0)
      setMatches(term && el ? findRanges(el, [term]) : [])
    }, 80)
    return () => window.clearTimeout(timer)
  }, [query, stream])

  // 回复还在输出、展开了工具行：内容变了就重查，当前位置尽量不变
  useEffect(() => {
    const el = stream()
    const term = searchLiteral(query)
    if (!el || !term) return
    let timer = 0
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const next = findRanges(el, [term])
        setMatches(next)
        setIndex(i => Math.min(i, Math.max(0, next.length - 1)))
      }, 250)
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [query, stream])

  useEffect(() => {
    setMarks('find-match', owner, matches)
    setMarks('find-current', owner, matches[index] ? [matches[index]] : [])
    const scroller = stream()?.closest<HTMLElement>('.conversation-scroller')
    if (pendingReveal.current && matches[index] && scroller) reveal(matches[index], scroller)
    pendingReveal.current = false
  }, [matches, index, owner, stream])

  useEffect(
    () => () => {
      setMarks('find-match', owner, [])
      setMarks('find-current', owner, [])
    },
    [owner],
  )

  const go = (delta: number): void => {
    if (matches.length === 0) return
    pendingReveal.current = true
    setIndex(i => (i + delta + matches.length) % matches.length)
  }

  const count = !searchLiteral(query)
    ? ''
    : matches.length === 0
      ? tr('content.find.none')
      : tr('content.find.count', { current: index + 1, total: matches.length })

  return (
    <div
      role="search"
      className="pop-in absolute top-3 right-5 z-30 flex h-9 max-w-[calc(100%-2rem)] items-center gap-1 rounded-lg border border-line bg-popover pr-1 pl-2.5 shadow-popover"
    >
      <Search size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      <input
        ref={input}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            go(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        aria-label={tr('content.find.label')}
        placeholder={tr('content.find.placeholder')}
        className="h-full w-44 min-w-0 bg-transparent text-list text-fg outline-none placeholder:text-fg-faint"
      />
      <span aria-live="polite" className="min-w-12 shrink-0 text-right text-meta text-fg-muted tabular-nums">
        {count}
      </span>
      <IconButton
        icon={ChevronUp}
        label={tr('content.find.previous')}
        size={24}
        iconSize={14}
        disabled={matches.length === 0}
        onClick={() => go(-1)}
      />
      <IconButton
        icon={ChevronDown}
        label={tr('content.find.next')}
        size={24}
        iconSize={14}
        disabled={matches.length === 0}
        onClick={() => go(1)}
      />
      <IconButton icon={X} label={tr('content.find.close')} size={24} iconSize={14} onClick={onClose} />
    </div>
  )
}
