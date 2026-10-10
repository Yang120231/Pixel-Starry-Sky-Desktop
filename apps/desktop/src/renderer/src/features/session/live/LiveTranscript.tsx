import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 真实会话的对话流：按「轮」排列条目，连续的工具调用串成一组，每轮结束后显示改动文件卡片
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileChange, Item, SessionSnapshot } from '@pixelsky/protocol'
import { Spinner, cn } from '@/ui'
import { toChangedFiles } from '@/features/engine'
import type { ChangedFiles } from '@/data'
import { ChangedFilesCard } from '../ChangedFilesCard'
import { TurnStats } from '../TurnStats'
import { Markdown } from '@/ui/markdown/Markdown'
import { NoticeRow, ReasoningBlock, TodoCard, ToolItemRow, UserBubble } from './ItemRows'
import { isStarting } from '../queueView'
import { NoticeActions } from './NoticeActions'
import { AssistantMessageActions, UserMessageActions } from './MessageActions'
import { platformNoticeText } from './errorKind'
import { useItemLocation } from '@/features/search/useItemLocation'
import { JumpToLatest } from './JumpToLatest'
import { contentMark, followResize, nearBottom } from './scrollFollow'

type ToolItem = Extract<Item, { kind: 'command' | 'file_change' | 'tool' }>

type Block =
  | { type: 'item'; item: Item }
  | { type: 'tools'; key: string; items: ToolItem[] }
  | { type: 'changes'; key: string; data: ChangedFiles }

function isTool(item: Item): item is ToolItem {
  return item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool'
}

/** 把条目分成显示块；running 为真时最后一轮还没结束，不显示它的改动卡片 */
function toBlocks(items: Item[], running: boolean): Block[] {
  const blocks: Block[] = []
  let changes: FileChange[] = []
  let turnKey = 'start'
  const flushChanges = (): void => {
    const data = toChangedFiles(changes)
    if (data) blocks.push({ type: 'changes', key: `changes-${turnKey}`, data })
    changes = []
  }
  for (const item of items) {
    if (item.kind === 'user' && item.mode !== 'guidance') {
      flushChanges()
      turnKey = item.id
    }
    // 一轮的统计放在这一轮最后（改动文件卡片之后），docs/ui/usage.md §4
    if (item.kind === 'turn_stats') flushChanges()
    if (item.kind === 'file_change' && item.status === 'completed') changes.push(...item.changes)
    if (isTool(item)) {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'tools') last.items.push(item)
      else blocks.push({ type: 'tools', key: `tools-${item.id}`, items: [item] })
    } else {
      blocks.push({ type: 'item', item })
    }
  }
  if (!running) flushChanges()
  return blocks
}

function ItemView({ item, reply }: { item: Item; reply?: string }) {
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
}

export function LiveTranscript({ snapshot }: { snapshot: SessionSnapshot | null }) {
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
  const detachForSearch = useCallback(() => {
    stick.current = false
    detached.current = true
  }, [])
  const highlight = useItemLocation(snapshot?.record.id ?? null, scroller, !!snapshot, detachForSearch)
  const running = !!snapshot && snapshot.state !== 'idle'
  const items = snapshot?.items ?? []
  const blocks = useMemo(() => toBlocks(items, running), [items, running])
  // 每轮统计行对应的回复：这一轮最后一段助手文字（中间穿插工具调用的文字段不算）
  const replies = useMemo(() => {
    const map = new Map<string, string>()
    let last: string | null = null
    for (const item of items) {
      if (item.kind === 'user' && item.mode !== 'guidance') last = null
      else if (item.kind === 'assistant' && item.text) last = item.text
      else if (item.kind === 'turn_stats' && last) map.set(item.id, last)
    }
    return map
  }, [items])

  // 最后一块不是正在流式输出的文字时，显示「思考中」
  const last = items[items.length - 1]
  const streaming = last && (last.kind === 'assistant' || last.kind === 'reasoning') && last.status === 'running'
  const showThinking = snapshot?.state === 'running' && !streaming
  // 空闲时直接发送的消息在引擎启动期间先显示在对话里（不是排队），开始执行后由正式的用户消息替换
  const starting = snapshot ? snapshot.queue.filter(q => isStarting(q, snapshot.queuePaused)) : []

  // 最近一轮（最后一条用户消息之后）的最后一条错误：给一键按钮（docs/ui/source-switch.md §3.5）
  let actionNoticeId: string | null = null
  if (!running) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.kind === 'user') break
      if (it.kind === 'notice' && it.level === 'error') {
        actionNoticeId = it.id
        break
      }
    }
  }

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [blocks, showThinking, starting.length])

  // 切换会话时回到底部
  useLayoutEffect(() => {
    stick.current = true
    detached.current = false
    jumping.current = false
    setAway(false)
    setUnseen(false)
  }, [snapshot?.record.id])

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
      if (followResize(stick.current, lastInteract.current, performance.now())) {
        el.scrollTop = el.scrollHeight
      } else if (stick.current && !detached.current) {
        const near = nearBottom(el)
        stick.current = near
        setAway(!near)
      }
    })
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const jumpToLatest = (): void => {
    const el = scroller.current
    if (!el) return
    stick.current = true
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={e => {
          if (jumping.current) return
          const near = nearBottom(e.currentTarget)
          if (!detached.current) stick.current = near
          setAway(!near)
          if (near) setUnseen(false)
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
        onWheel={resume}
        onTouchMove={resume}
        onPointerDown={() => {
          resume()
          lastInteract.current = performance.now()
        }}
        onKeyDown={() => {
          resume()
          lastInteract.current = performance.now()
        }}
        data-search-session={snapshot?.record.id}
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
          {blocks.map((b, i) => {
            if (b.type === 'tools') {
              return (
                <div key={b.key} className="conversation-message flex flex-col border-l border-line pl-1.5">
                  {b.items.map(it => (
                    <div
                      key={it.id}
                      data-search-item={it.id}
                      className={highlight === it.id ? 'search-hit' : undefined}
                    >
                      <ToolItemRow item={it} />
                    </div>
                  ))}
                </div>
              )
            }
            if (b.type === 'changes')
              return (
                <ChangedFilesCard
                  key={b.key}
                  className="conversation-message"
                  data={b.data}
                  target={snapshot ? { sessionId: snapshot.record.id } : undefined}
                />
              )
            // 统计关闭时 TurnStats 不产生 DOM，避免外层空块在 flex 列表里留下间距。
            if (b.item.kind === 'turn_stats')
              return <ItemView key={b.item.id} item={b.item} reply={replies.get(b.item.id)} />
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
                  {item.id === actionNoticeId && <NoticeActions record={snapshot.record} text={item.text} />}
                </div>
              )
            }
            return (
              <div
                key={item.id}
                data-search-item={item.id}
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
          })}
          {starting.map(q => (
            <div key={q.id} data-starting-message={q.id} className="flex flex-col gap-3">
              <div className={cn('conversation-user-row', blocks.length > 0 && 'mt-4')}>
                <UserBubble
                  item={{ kind: 'user', id: q.id, text: q.text, attachments: q.attachments, createdAt: q.createdAt }}
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
              {tr('session.live.LiveTranscript.working')}{' '}
            </div>
          )}
        </div>
      </div>
      {away && snapshot && <JumpToLatest unseen={unseen} onClick={jumpToLatest} />}
    </div>
  )
}
