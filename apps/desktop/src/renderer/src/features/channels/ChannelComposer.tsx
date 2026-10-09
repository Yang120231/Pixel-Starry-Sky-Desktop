import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useId, useLayoutEffect, useMemo, useState, type KeyboardEvent, type Ref, type RefObject } from 'react'
import { ArrowUp, CornerUpLeft, X } from 'lucide-react'
import { cn, IconButton } from '@/ui'
import { CARD_STYLE } from '@/features/session/Composer'
import { useComposerDraft } from '@/features/engine/drafts'
import { isDemo } from '@/data'
import type { Channel, ChannelMember, ChannelTextMessage } from '@/data/types'
import { excerpt, filterMentionable, insertMention, mentionAt } from './model'
import { MentionMenu } from './MentionMenu'

const LINE_HEIGHT = 24
const MAX_ROWS = 8

/** 频道输入框（docs/ui/channels.md §6）：只有文本和发送；@ 菜单、引用条、按频道保存草稿 */
export function ChannelComposer({
  channel,
  members,
  selfId,
  replyTo,
  replyAuthor,
  onSend,
  onCancelReply,
  inputRef,
}: {
  channel: Channel
  /** 这个频道的成员 */
  members: readonly ChannelMember[]
  selfId: string | null
  replyTo: ChannelTextMessage | null
  replyAuthor: ChannelMember | undefined
  onSend: (text: string) => void
  onCancelReply: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  useI18n()
  const menuId = useId()
  // 演示数据和真实数据共用草稿存储，演示模式加前缀避免混在一起
  const [value, setValue] = useComposerDraft(`${isDemo ? 'demo:' : ''}channel:${channel.id}`)
  const [caret, setCaret] = useState(0)
  const [selected, setSelected] = useState(0)
  /** 按 Esc 关掉的那个 @ 的位置；光标移到别的 @ 时菜单重新出现 */
  const [dismissed, setDismissed] = useState<number | null>(null)
  const mention = mentionAt(value, caret)
  const candidates = useMemo(
    () => (mention ? filterMentionable(members, mention.query, selfId) : []),
    [members, mention?.query, mention?.start, selfId],
  )
  const menuOpen = !!mention && dismissed !== mention.start
  const canSend = value.trim().length > 0

  // 自动增高，最多 8 行
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, LINE_HEIGHT * MAX_ROWS + 16)}px`
  }, [value, inputRef])

  useLayoutEffect(() => setSelected(0), [mention?.query, mention?.start])

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? 0)

  const choose = (index: number) => {
    const member = candidates[index]
    if (!mention || !member) return
    const next = insertMention(value, { start: mention.start, end: caret }, member.name)
    setValue(next.text)
    setCaret(next.caret)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(next.caret, next.caret))
  }

  const send = () => {
    if (!canSend) return
    onSend(value)
    setValue('')
    setCaret(0)
    setDismissed(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组合中（候选字还没上屏）不处理 Enter / 方向键
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (menuOpen) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && candidates.length) {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setSelected(i => (i + delta + candidates.length) % candidates.length)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && candidates.length) {
        e.preventDefault()
        choose(selected)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissed(mention.start)
        return
      }
    }
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault()
      e.stopPropagation()
      onCancelReply()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="conversation-inset conversation-reading shrink-0 pb-4">
      <div className="relative">
        {menuOpen && <MentionMenu id={menuId} members={candidates} selected={selected} onChoose={choose} />}
        <div className={cn(CARD_STYLE, 'overflow-hidden')}>
          {replyTo && (
            <div className="flex min-w-0 items-center gap-2 border-b border-line-subtle py-1 pr-1.5 pl-3 text-meta text-fg-muted">
              <CornerUpLeft size={13} strokeWidth={1.5} className="shrink-0" />
              <span className="shrink-0 font-medium">
                {tr('channels.replyingTo', { name: replyAuthor?.name ?? '?' })}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg-faint">{excerpt(replyTo.text)}</span>
              <IconButton
                icon={X}
                label={tr('channels.cancelReply')}
                size={22}
                iconSize={13}
                onClick={() => {
                  onCancelReply()
                  inputRef.current?.focus()
                }}
              />
            </div>
          )}
          <div className="flex items-end gap-2 py-2 pr-2 pl-4">
            <textarea
              ref={inputRef as Ref<HTMLTextAreaElement>}
              rows={1}
              value={value}
              aria-label={tr('channels.composer.label')}
              placeholder={tr('channels.composer.placeholder', { name: channel.name })}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-activedescendant={menuOpen && candidates.length ? `${menuId}-${selected}` : undefined}
              onChange={e => {
                setValue(e.target.value)
                setCaret(e.target.selectionStart ?? e.target.value.length)
              }}
              onSelect={syncCaret}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onKeyDown={onKeyDown}
              className="block max-h-[208px] min-h-8 flex-1 resize-none bg-transparent py-1 text-prose leading-6 text-fg outline-none placeholder:text-fg-faint"
            />
            <button
              type="button"
              aria-label={tr('channels.composer.send')}
              title={tr('channels.composer.send')}
              aria-disabled={!canSend}
              onClick={send}
              className={cn(
                'no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-full',
                canSend ? 'press bg-primary text-primary-fg hover:opacity-90' : 'bg-disabled text-disabled-fg',
              )}
            >
              <ArrowUp size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
      {isDemo && <p className="mt-1.5 px-1 text-meta text-fg-faint">{tr('channels.composer.demoHint')}</p>}
    </div>
  )
}
