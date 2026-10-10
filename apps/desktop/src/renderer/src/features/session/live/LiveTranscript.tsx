import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 真实会话的对话流：按「轮」排列条目，连续的工具调用串成一组，每轮结束后显示改动文件卡片
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
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

/** 离底部不到这么多像素时，新内容到达会自动滚到底 */
const STICK_PX = 80

export function LiveTranscript({ snapshot }: { snapshot: SessionSnapshot | null }) {
  useI18n()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const detached = useRef(false)
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
  }, [snapshot?.record.id])

  return (
    <div
      ref={scroller}
      onScroll={e => {
        const el = e.currentTarget
        if (!detached.current) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
      }}
      onWheel={() => {
        detached.current = false
      }}
      onTouchMove={() => {
        detached.current = false
      }}
      onPointerDown={() => {
        detached.current = false
      }}
      onKeyDown={() => {
        detached.current = false
      }}
      data-search-session={snapshot?.record.id}
      className="conversation-scroller selectable min-h-0 flex-1 overflow-y-auto bg-app"
    >
      <div data-conversation-stream className="conversation-inset conversation-reading flex flex-col gap-3 pt-5 pb-6">
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
                  <div key={it.id} data-search-item={it.id} className={highlight === it.id ? 'search-hit' : undefined}>
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
  )
}
