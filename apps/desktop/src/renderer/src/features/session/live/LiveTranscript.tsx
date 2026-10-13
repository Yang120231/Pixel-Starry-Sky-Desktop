import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 真实会话的对话流：按「轮」排列条目，每轮的过程收成一行「执行」（docs/ui/conversation-concise.md），
// 里面连续的工具调用串成一组；每轮结束后显示改动文件卡片
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { TurnRail } from './TurnRail'
import { turnsOf } from './turnRailModel'
import { useTurnRailOn } from '@/features/settings/turnRail'
import { useTranscriptWindowSize } from '@/features/settings/longConversation'
import { hiddenCount, initialHidden, revealEarlier, revealFor, startIndex, turnStarts } from './transcriptWindow'
import {
  anchorOf,
  placeOf,
  registerTranscriptView,
  restoredHidden,
  savePlace,
  scrollToPlace,
  type TranscriptPlace,
} from './transcriptPlaces'
import { useLightweight } from '@/features/recovery/lightweight'
import type { Item, SessionSnapshot } from '@pixelsky/protocol'
import { Spinner, cn } from '@/ui'
import type { ChangedFiles } from '@/data'
import { ChangedFilesCard } from '../ChangedFilesCard'
import { TurnStats } from '../TurnStats'
import { Markdown } from '@/ui/markdown/Markdown'
import { NoticeRow, ReasoningBlock, TodoCard, ToolItemRow, UserBubble } from './ItemRows'
import { CompactionRow } from './CompactionRow'
import { isStarting } from '../queueView'
import { NoticeActions } from './NoticeActions'
import { AssistantMessageActions, UserMessageActions } from './MessageActions'
import { platformNoticeText } from './errorKind'
import { useItemLocation } from '@/features/search/useItemLocation'
import { ExpandScope } from '@/features/search/expand'
import { DETACH_EVENT, useItemNavigation } from '@/features/search/navigation'
import { JumpToLatest } from './JumpToLatest'
import {
  afterResize,
  contentMark,
  innerCanScrollUp,
  nearBottom,
  scrollUpKey,
  scrolledUp,
  type ScrollPos,
} from './scrollFollow'
import { changesHeight, itemHeight, toolsHeight } from './blockHeight'
import { reviewTurn } from '@/features/panel/artifacts/focus'
import { turnReplies } from './turnFold'
import { innerBlocks, sameItems, toBlocks, type Block, type ChangesCache } from './changeBlocks'
import { TurnProcess } from './TurnProcess'
import { WAIT_CLOCK_MS, clockText, waitingFor } from './currentStep'
import { useSince } from './stepClock'
import { formatDuration } from './agentTrace'

/** 块没渲染过时的占位高度（content-visibility，见 blockHeight.ts）；按条目对象缓存，流式输出时只重算在动的那一条 */
const heights = new WeakMap<Item, number>()
function estimate(item: Item): number {
  let height = heights.get(item)
  if (height === undefined) heights.set(item, (height = itemHeight(item)))
  return height
}
const placeholder = (px: number): CSSProperties => ({ containIntrinsicBlockSize: `auto ${px}px` })

// 下面几个显示组件都 memo：条目对象没变（protocol 的 reduce 只替换变了的那一条）就不重新渲染，
// 流式输出时只有最后一条在动（docs/ui/conversation-ux.md §2.7）
const ItemView = memo(function ItemView({ item, reply }: { item: Item; reply?: string }) {
  useI18n()
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} actions={<UserMessageActions item={item} />} />
    case 'assistant':
      if (!item.text) return null
      return (
        <>
          <Markdown text={item.text} streaming={item.status === 'running'} />
          {item.status === 'interrupted' && (
            <div className="mt-1.5 text-meta text-fg-faint">{tr('session.live.ItemRows.interrupted')}</div>
          )}
        </>
      )
    case 'reasoning':
      return <ReasoningBlock item={item} />
    case 'todo':
      return <TodoCard item={item} />
    case 'notice':
      return <NoticeRow item={item} />
    case 'compaction':
      return <CompactionRow item={item} />
    case 'turn_stats':
      // 这一轮回复的「复制」放在统计行最前面，不额外占一行
      return (
        <TurnStats
          usage={item.usage}
          className="conversation-message -mt-1 px-0.5"
          leading={reply ? <AssistantMessageActions text={reply} /> : undefined}
        />
      )
    default:
      return null
  }
})

const TurnChanges = memo(function TurnChanges({
  data,
  sessionId,
  turnKey,
}: {
  data: ChangedFiles
  sessionId: string | null
  turnKey: string
}) {
  const target = useMemo(() => (sessionId ? { sessionId } : undefined), [sessionId])
  // 分组时每组多一行小标题
  const style = useMemo(
    () =>
      placeholder(
        changesHeight(data.groups ? data.groups.reduce((n, g) => n + g.files.length + 1, 0) : data.files.length),
      ),
    [data],
  )
  // 「审查」：在右侧「产物」里打开这一轮的改动（docs/ui/conversation-ux.md §2.1）
  const review = useMemo(
    () => (sessionId ? () => reviewTurn(sessionId, turnKey === 'start' ? null : turnKey) : undefined),
    [sessionId, turnKey],
  )
  return (
    <ChangedFilesCard className="conversation-message" data={data} target={target} style={style} onReview={review} />
  )
})

/**
 * 执行块：里面的条目对象都没变（流式输出时只有最后一轮在变）就不重新渲染。
 * render 每次都是新函数，不比较；里面的显示只依赖条目和搜索高亮
 */
const ProcessBlock = memo(
  function ProcessBlock({
    items,
    running,
    live,
    durationMs,
    render,
  }: {
    items: Item[]
    running: boolean
    live: boolean
    durationMs: number | null
    highlight: string | null
    render: (items: Item[]) => ReactNode
  }) {
    return (
      <div className="conversation-message" style={placeholder(34)}>
        <TurnProcess items={items} running={running} live={live} durationMs={durationMs} render={render} />
      </div>
    )
  },
  (a, b) =>
    a.running === b.running &&
    a.live === b.live &&
    a.durationMs === b.durationMs &&
    a.highlight === b.highlight &&
    sameItems(a.items, b.items),
)

export function LiveTranscript({
  snapshot,
  header,
  footer,
}: {
  snapshot: SessionSnapshot | null
  header?: ReactNode
  /** 对话末尾（最后一轮后面）：极简模式下运行中的计划（InlinePlan） */
  footer?: ReactNode
}) {
  useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const stream = useRef<HTMLDivElement>(null)
  // stick：新内容到达时滚到底；detached：搜索跳转后暂时不按位置重新判断 stick，直到用户自己滚动或操作
  const stick = useRef(true)
  const detached = useRef(false)
  // 回到最新（docs/ui/conversation-ux.md §2.4）：away 离开了底部，unseen 离开后又来了新内容
  const [away, setAway] = useState(false)
  const [unseen, setUnseen] = useState(false)
  // 最近一次在对话里点或按键的时间：之后很短时间内对话流变高（例如展开工具输出）不跟到底
  const lastInteract = useRef(0)
  // 点「回到最新」后的平滑滚动期间，不按中途位置改 stick
  const jumping = useRef(false)
  // released：用户自己往上滚了（滚轮、触控板、按键、拖滚动条）。一往上就不再跟到底，哪怕还在离底部 80px 以内——
  // 否则 AI 输出时每一格滚轮还没滚出 80px 就被新内容拽回底部，表现成「滑不上去」。
  // 用户往下滚回底部附近、点「回到最新」、切换会话时才恢复
  const released = useRef(false)
  const lastPos = useRef<ScrollPos | null>(null)
  const release = (): void => {
    released.current = true
    stick.current = false
  }
  const detachForSearch = useCallback(() => {
    stick.current = false
    detached.current = true
  }, [])
  const highlight = useItemLocation(snapshot?.record.id ?? null, scroller, !!snapshot, detachForSearch)
  const running = !!snapshot && snapshot.state !== 'idle'
  const items = snapshot?.items ?? []
  // 轮次跳转条（docs/ui/turn-rail.md）
  const showTurns = useTurnRailOn()
  const sessionId = snapshot?.record.id ?? null

  // 长对话只显示最近几轮（docs/ui/turn-rail.md §9）：win.hidden 是从头隐藏了几轮。
  // 打开这个会话时按设置算一次，之后只会变少（点「显示更早的」、跳转到隐藏的内容），新的轮次往后加不会把已显示的藏回去
  const windowSize = useTranscriptWindowSize()
  const [win, setWin] = useState<{ sessionId: string | null; hidden: number } | null>(null)
  const starts = useMemo(() => turnStarts(snapshot?.items ?? []), [snapshot?.items])
  // 标签卸载过再挂载：沿用卸载前显示的轮数（transcriptPlaces.ts）；轻量模式下最多只显示设置的轮数
  const capped = useLightweight()
  const wanted =
    snapshot && snapshot.items.length > 0
      ? restoredHidden(placeOf(sessionId)?.hidden ?? null, initialHidden(starts.length, windowSize), windowSize, capped)
      : 0
  const opened = !!win && win.sessionId === sessionId
  if (snapshot && snapshot.items.length > 0 && !opened) setWin({ sessionId, hidden: wanted })
  const hidden = opened && windowSize !== null ? win.hidden : opened ? 0 : wanted
  const hiddenTurns = hiddenCount(starts.length, hidden)
  // 卸载前的位置：不能卸载时再读 DOM（标签已经隐藏），所以滚动停下后记锚点，卸载时只写最后记下的
  const placeRef = useRef<
    { sessionId: string | null; hidden: number; atBottom: boolean } & Pick<TranscriptPlace, 'anchor' | 'scrollTop'>
  >({
    sessionId: null,
    hidden: 0,
    atBottom: true,
    anchor: null,
    scrollTop: 0,
  })
  const shownTurns = useRef(0)
  shownTurns.current = Math.max(0, starts.length - hiddenTurns)
  // 内容还没到（快照在拉）时 hidden 只是占位的 0：沿用已保存的位置，等内容到了再更新，免得此时切走把它覆盖掉
  if (placeRef.current.sessionId !== sessionId)
    placeRef.current = { hidden, atBottom: true, anchor: null, scrollTop: 0, ...placeOf(sessionId), sessionId }
  if (opened) placeRef.current.hidden = hidden
  const placeTimer = useRef<number>(0)
  const firstShown = startIndex(starts, hidden)
  const shownItems = useMemo(
    () => (firstShown > 0 && snapshot ? snapshot.items.slice(firstShown) : (snapshot?.items ?? [])),
    [snapshot, firstShown],
  )
  const turns = useMemo(() => {
    const list = turnsOf(shownItems)
    return hiddenTurns > 0 ? list.map(t => ({ ...t, n: t.n + hiddenTurns })) : list
  }, [shownItems, hiddenTurns])
  const changesCache = useRef<{ sessionId: string | null; map: ChangesCache }>({ sessionId: null, map: new Map() })
  const blocks = useMemo(() => {
    if (changesCache.current.sessionId !== sessionId) changesCache.current = { sessionId, map: new Map() }
    return toBlocks(shownItems, running, changesCache.current.map)
  }, [shownItems, running, sessionId])
  // 每轮统计行对应的回复：和显示在外面的「最后的回复」是同一段（中间穿插工具调用的过渡话不算）
  const replies = useMemo(() => turnReplies(shownItems), [shownItems])

  // 最后一块不是正在流式输出的文字、也不是转着圈的执行块时，显示「处理中」（不然几个转圈同时出现）
  const last = items[items.length - 1]
  const streaming = last && (last.kind === 'assistant' || last.kind === 'reasoning') && last.status === 'running'
  const lastBlock = blocks[blocks.length - 1]
  const busyBlock = lastBlock?.type === 'process' && lastBlock.running
  // 正在压缩时压缩条自己带计时，不再叠一行「正在思考 · 53s」
  const compacting = last?.kind === 'compaction' && last.status === 'running'
  const showThinking = snapshot?.state === 'running' && !streaming && !busyBlock && !compacting
  // 写具体在等什么（刚发消息：正在思考；工具刚结束：正在看结果），等久了带上秒数（docs/ui/conversation-concise.md §7）
  const waiting = showThinking ? waitingFor(items) : null
  const waitedMs = useSince(waiting ? `wait:${last?.id ?? 'start'}:${waiting}` : null, showThinking)
  // 空闲时直接发送的消息在引擎启动期间先显示在对话里（不是排队），开始执行后由正式的用户消息替换
  const starting = snapshot ? snapshot.queue.filter(q => isStarting(q, snapshot.queuePaused)) : []

  // 最近一轮（最后一条用户消息之后）的最后一条错误：给一键按钮（docs/ui/source-switch.md §3.5）
  let actionNoticeId: string | null = null
  let turnStart: number | null = null
  if (!running) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.kind === 'user') break
      if (it.kind === 'notice' && it.level === 'error') {
        actionNoticeId = it.id
        break
      }
    }
    // 「查看日志」从这一轮的用户消息时间筛起（docs/ui/logging.md §3.2）
    if (actionNoticeId)
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.kind === 'user' && it.mode !== 'guidance') {
          turnStart = it.createdAt
          break
        }
      }
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [blocks, showThinking, starting.length])

  // 显示更早的一批：补出来的内容在上面，屏幕上正在看的位置不动。
  // 记下补之前最上面那条可见条目的位置，补完在布局阶段把滚动位置加上它挪动的距离（不依赖浏览器自己的滚动锚定）
  const keepPlace = useRef<{ el: HTMLElement; top: number } | null>(null)
  const showEarlier = (step: number | null): void => {
    const el = scroller.current
    if (!el || hidden <= 0) return
    const next = revealEarlier(hidden, step)
    if (next === hidden) return
    const box = el.getBoundingClientRect()
    for (const row of el.querySelectorAll<HTMLElement>('[data-search-item]')) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom > box.top + 1) {
        keepPlace.current = { el: row, top: rect.top - box.top }
        break
      }
    }
    // 先不贴底：补出来的内容会让对话流变高，不能被当成新内容又拽回底部
    detachForSearch()
    setWin({ sessionId, hidden: next })
  }
  useLayoutEffect(() => {
    const place = keepPlace.current
    const el = scroller.current
    if (!place || !el) return
    keepPlace.current = null
    if (place.el.isConnected)
      el.scrollTop += place.el.getBoundingClientRect().top - el.getBoundingClientRect().top - place.top
  }, [firstShown])

  // 要跳到的条目在隐藏的部分（全局搜索、从别处打开对话并定位）：先展开到它所在那一轮，再由 useItemLocation 找它
  const navigation = useItemNavigation()
  useLayoutEffect(() => {
    if (!navigation || navigation.sessionId !== sessionId || !snapshot || hidden <= 0) return
    const next = revealFor(snapshot.items, starts, hidden, navigation.itemId)
    if (next === hidden) return
    detachForSearch()
    setWin({ sessionId, hidden: next })
  }, [navigation, sessionId, snapshot, starts, hidden, detachForSearch])

  // 对话内搜索等程序滚动之前会先发 DETACH_EVENT：和搜索跳转一样暂时不贴底
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.addEventListener(DETACH_EVENT, detachForSearch)
    return () => el.removeEventListener(DETACH_EVENT, detachForSearch)
  }, [detachForSearch])

  // 切换会话时回到底部
  useLayoutEffect(() => {
    stick.current = true
    released.current = false
    lastPos.current = null
    detached.current = false
    jumping.current = false
    setAway(false)
    setUnseen(false)
  }, [snapshot?.record.id])

  // 标签卸载后重新挂载：第一次拿到这个会话的内容时，不在底部的回到卸载前的位置（在底部的照旧贴底）。
  // 要排在上面「贴底」和「切换会话」两个 effect 后面；正在有搜索跳转时让跳转优先
  const restoredFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!opened || !sessionId || restoredFor.current === sessionId) return
    restoredFor.current = sessionId
    const place = placeOf(sessionId),
      el = scroller.current
    if (!place || place.atBottom || !el || navigation?.sessionId === sessionId) return
    scrollToPlace(el, place)
    stick.current = false
    released.current = true
    setAway(true)
  }, [opened, sessionId, navigation])

  // 卸载时把最后记下的位置写进去；挂着期间登记给内存遥测
  useEffect(() => {
    const unregister = registerTranscriptView(() => shownTurns.current)
    return () => {
      unregister()
      window.clearTimeout(placeTimer.current)
      const last = placeRef.current
      if (last.sessionId) savePlace(last.sessionId, last)
    }
  }, [])

  // 离开底部期间条目增加或最后一条变长：「回到最新」变成「新内容」
  const mark = contentMark(items)
  const seenMark = useRef(mark)
  useEffect(() => {
    if (seenMark.current === mark) return
    seenMark.current = mark
    if (!stick.current) setUnseen(true)
  }, [mark])

  // 对话流高度变了（公式加载完、图片解码、输入框变高）：贴底时跟到底。
  // 用户刚点过或按过键（多半是展开了什么）就不跟，按实际位置重新判断，之后的新内容也不会把展开的内容顶上去
  useEffect(() => {
    const el = scroller.current,
      content = stream.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (jumping.current) return
      const next = afterResize(
        el,
        stick.current,
        detached.current || released.current,
        lastInteract.current,
        performance.now(),
      )
      if (next.follow) {
        el.scrollTop = el.scrollHeight
        return
      }
      stick.current = next.stick
      setAway(next.away)
      if (!next.away) setUnseen(false)
    })
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const jumpToLatest = (): void => {
    const el = scroller.current
    if (!el) return
    stick.current = true
    released.current = false
    detached.current = false
    setUnseen(false)
    // 离得很远时直接跳过去：平滑滚过一长段对话既慢，又要把沿途的内容都排版一遍
    if (el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 3) {
      el.scrollTop = el.scrollHeight
      return
    }
    jumping.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  // 用户自己滚动或操作：结束搜索跳转后的暂停和「回到最新」的平滑滚动
  const resume = (): void => {
    detached.current = false
    jumping.current = false
  }

  // 一个显示块；nested：在执行块里面（外面已经有左边线，工具组不再画）
  const renderBlock = (b: Block, i: number, nested = false): ReactNode => {
    if (b.type === 'process')
      return (
        <ProcessBlock
          key={b.key}
          items={b.items}
          running={b.running}
          live={b.running && snapshot?.state === 'running'}
          durationMs={b.durationMs}
          highlight={highlight}
          render={list => innerBlocks(list).map((inner, j) => renderBlock(inner, j, true))}
        />
      )

    if (b.type === 'tools') {
      return (
        <div
          key={b.key}
          className={cn('conversation-message flex flex-col', !nested && 'border-l border-line pl-1.5')}
          style={placeholder(toolsHeight(b.items.length))}
        >
          {b.items.map(it => (
            <div key={it.id} data-search-item={it.id} className={highlight === it.id ? 'search-hit' : undefined}>
              <ToolItemRow item={it} />
            </div>
          ))}
        </div>
      )
    }
    if (b.type === 'changes') return <TurnChanges key={b.key} data={b.data} sessionId={sessionId} turnKey={b.turnKey} />
    // 统计关闭时 TurnStats 不产生 DOM，避免外层空块在 flex 列表里留下间距。
    if (b.item.kind === 'turn_stats') return <ItemView key={b.item.id} item={b.item} reply={replies.get(b.item.id)} />
    const isUser = b.item.kind === 'user'
    const item = b.item
    if (item.kind === 'notice' && item.level === 'error' && snapshot) {
      const text = platformNoticeText(snapshot.record, item.text)
      return (
        <div
          key={item.id}
          data-search-item={item.id}
          className={['conversation-message', highlight === item.id ? 'search-hit' : ''].join(' ')}
        >
          <NoticeRow item={text === item.text ? item : { ...item, text }} />
          {item.id === actionNoticeId && (
            <NoticeActions
              record={snapshot.record}
              text={item.text}
              turnStart={turnStart}
              retry={snapshot.queue.length === 0}
            />
          )}
        </div>
      )
    }
    return (
      <div
        key={item.id}
        data-search-item={item.id}
        style={placeholder(estimate(item))}
        className={[
          'group/message',
          isUser ? 'conversation-user-row' : 'conversation-message',
          isUser && i > 0 ? 'mt-4' : '',
          highlight === item.id ? 'search-hit' : '',
        ].join(' ')}
      >
        <ItemView item={item} />
      </div>
    )
  }

  return (
    <ExpandScope.Provider value={snapshot?.record.id ?? null}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={e => {
            const el = e.currentTarget
            const pos = { top: el.scrollTop, height: el.scrollHeight }
            const up = scrolledUp(lastPos.current, pos)
            lastPos.current = pos
            if (jumping.current) return
            const near = nearBottom(el)
            // 往上滚了就松开；往下滚回底部附近（或内容变短、底部自己靠过来）才重新贴底
            if (up) released.current = true
            else if (near) released.current = false
            if (!detached.current) stick.current = near && !released.current
            setAway(!near)
            if (near) setUnseen(false)
            // 滚动停下 200 毫秒后记一次位置（标签已经隐藏就不记，那时量出来的不准）
            window.clearTimeout(placeTimer.current)
            placeTimer.current = window.setTimeout(() => {
              if (el.closest('[aria-hidden="true"]')) return
              placeRef.current.atBottom = nearBottom(el)
              placeRef.current.anchor = anchorOf(el)
              placeRef.current.scrollTop = el.scrollTop
            }, 200)
          }}
          onScrollEnd={e => {
            if (!jumping.current) return
            jumping.current = false
            // 平滑滚动期间又来了内容：补到真正的底部
            const el = e.currentTarget
            if (stick.current) el.scrollTop = el.scrollHeight
            const near = nearBottom(el)
            setAway(!near)
            if (near) setUnseen(false)
          }}
          onWheel={e => {
            resume()
            // 往上滚的第一下就松开，不等滚动事件：平滑滚动的前几帧只挪几像素，等它的话新内容已经把位置拽回去了
            const el = e.currentTarget
            if (e.deltaY < 0 && el.scrollTop > 0 && !innerCanScrollUp(e.target as Element, el)) release()
          }}
          onTouchMove={resume}
          onPointerDown={() => {
            resume()
            lastInteract.current = performance.now()
          }}
          onKeyDown={e => {
            resume()
            lastInteract.current = performance.now()
            const target = e.target as HTMLElement
            if (scrollUpKey(e) && !target.closest('input, textarea, select, [contenteditable="true"]')) release()
          }}
          data-search-session={snapshot?.record.id}
          data-custom-scrollbar
          className="conversation-scroller selectable min-h-0 flex-1 overflow-y-auto bg-app"
        >
          <div
            ref={stream}
            data-conversation-stream
            className="conversation-inset conversation-reading flex flex-col gap-3 pt-5 pb-6"
          >
            {!snapshot && (
              <div className="conversation-message flex items-center gap-2 py-8 text-list text-fg-muted">
                <Spinner size={14} />
                {tr('session.live.LiveTranscript.openingConversation')}{' '}
              </div>
            )}
            {header}
            {hiddenTurns > 0 && (
              <div
                data-transcript-hidden
                data-hidden-turns={hiddenTurns}
                className="conversation-message flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-subtle px-3 py-2 text-meta text-fg-muted"
              >
                <span className="tabular-nums">{tr('longConversation.hidden', { n: hiddenTurns })}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {windowSize !== null && (
                    <button
                      type="button"
                      data-transcript-show-earlier
                      onClick={() => showEarlier(windowSize)}
                      className="press rounded-md px-2 py-1 text-fg-secondary outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {tr('longConversation.showEarlier', { n: Math.min(windowSize, hiddenTurns) })}
                    </button>
                  )}
                  <button
                    type="button"
                    data-transcript-show-all
                    onClick={() => showEarlier(null)}
                    className="press rounded-md px-2 py-1 text-fg-secondary outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {tr('longConversation.showAll')}
                  </button>
                </span>
              </div>
            )}
            {blocks.map((b, i) => renderBlock(b, i))}
            {footer}
            {starting.map(q => (
              <div key={q.id} data-starting-message={q.id} className="flex flex-col gap-3">
                <div className={cn('conversation-user-row', blocks.length > 0 && 'mt-4')}>
                  <UserBubble
                    item={{
                      kind: 'user',
                      id: q.id,
                      text: q.text,
                      attachments: q.attachments,
                      files: q.files,
                      createdAt: q.createdAt,
                    }}
                  />
                </div>
                <div className="conversation-message flex h-[30px] items-center gap-2 px-2 text-list text-fg-muted">
                  <Spinner size={13} />
                  {tr('session.queue.starting')}
                </div>
              </div>
            ))}
            {showThinking && (
              <div className="conversation-message flex h-[30px] items-center gap-2 px-2 text-list text-fg-muted">
                <Spinner size={13} />
                <span className="tabular-nums">
                  {waiting ? tr(`session.wait.${waiting}`) : tr('session.live.LiveTranscript.working')}
                  {waitedMs >= WAIT_CLOCK_MS && ` · ${clockText(waitedMs, formatDuration)}`}
                </span>
              </div>
            )}
          </div>
        </div>
        {away && snapshot && <JumpToLatest unseen={unseen} onClick={jumpToLatest} />}
        {/* 滚动条和轮次刻度合成一条（docs/ui/turn-rail.md §8）；设置里关掉轮次时只剩滚动条 */}
        {snapshot && (
          <TurnRail
            turns={turns}
            scroller={scroller}
            showTurns={showTurns}
            onBeforeJump={detachForSearch}
            hiddenTurns={hiddenTurns}
            onShowEarlier={windowSize !== null ? () => showEarlier(windowSize) : undefined}
          />
        )}
      </div>
    </ExpandScope.Provider>
  )
}
