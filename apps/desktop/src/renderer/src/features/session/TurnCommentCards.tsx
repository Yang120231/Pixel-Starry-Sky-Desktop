// 会话评论（docs/ui/channels-collab-v2.md §7）：每一轮下方的「评论」按钮、评论框和评论卡，交给频道成员的弹窗
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Check, MessageSquarePlus, RotateCcw, Send, Trash2, Users } from 'lucide-react'
import type { Item } from '@pixelsky/protocol'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { IconButton, Select, cn, useToast } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { channelActions, useChannels } from '@/features/channels/store'
import {
  addTurnComment,
  channelRequest,
  closeTurnComment,
  commentMessage,
  openTurnComment,
  removeTurnComment,
  turnNumbers,
  updateTurnComment,
  useTurnCommentDraft,
  useTurnComments,
  withCurrentTurns,
  type TurnComment,
} from './turnComments'

/** 由会话视图提供：会话、当前条目、交给 AI（没有输入框时为 null） */
export interface TurnCommentsValue {
  sessionId: string
  title: string
  items(): readonly Item[]
  handoff: ((text: string) => Promise<'started' | 'queued'>) | null
}

export const TurnCommentsContext = createContext<TurnCommentsValue | null>(null)

const ICON =
  'press no-drag inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg'
const ACTION =
  'press inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-meta text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50'

/** 统计行最前面的「评论这一轮」 */
export function TurnCommentButton({ turnKey }: { turnKey: string }) {
  useI18n()
  const ctx = useContext(TurnCommentsContext)
  if (!ctx) return null
  return (
    <button
      type="button"
      data-turn-comment-add
      aria-label={tr('turnComment.add')}
      title={tr('turnComment.add')}
      className={cn(ICON, 'opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100')}
      onClick={() =>
        openTurnComment({
          sessionId: ctx.sessionId,
          turnKey,
          turn: turnNumbers(ctx.items()).get(turnKey) ?? 0,
          quote: '',
        })
      }
    >
      <MessageSquarePlus size={13} strokeWidth={1.5} />
    </button>
  )
}

/** 这一轮的评论框和评论卡；没有时不产生 DOM */
export function TurnCommentList({ turnKey }: { turnKey: string }) {
  useI18n()
  const ctx = useContext(TurnCommentsContext)
  const all = useTurnComments(ctx?.sessionId ?? null)
  const draft = useTurnCommentDraft()
  const [showResolved, setShowResolved] = useState(false)
  const comments = useMemo(() => all.filter(c => c.turnKey === turnKey), [all, turnKey])
  if (!ctx) return null
  const editing = draft?.sessionId === ctx.sessionId && draft.turnKey === turnKey ? draft : null
  if (!editing && !comments.length) return null
  // 存的编号可能是旧规则算的：按当前对话重算（withCurrentTurns）
  const current = withCurrentTurns(comments, ctx.items())
  const open = current.filter(c => !c.resolved)
  const resolved = current.filter(c => c.resolved)
  return (
    <div data-search-item={turnKey} data-turn-comments className="conversation-message mt-2 flex flex-col gap-2">
      {open.map(c => (
        <CommentCard key={c.id} comment={c} ctx={ctx} sessionId={ctx.sessionId} />
      ))}
      {resolved.length > 0 && (
        <button
          type="button"
          className={cn(ACTION, 'self-start')}
          aria-expanded={showResolved}
          onClick={() => setShowResolved(v => !v)}
        >
          <Check size={12} strokeWidth={1.75} />
          {tr('turnComment.resolvedCount', { n: resolved.length })}
        </button>
      )}
      {showResolved && resolved.map(c => <CommentCard key={c.id} comment={c} ctx={ctx} sessionId={ctx.sessionId} />)}
      {editing && (
        <CommentEditor
          key={editing.token}
          turn={editing.turn}
          quote={editing.quote}
          onCancel={closeTurnComment}
          onSave={text => {
            addTurnComment(ctx.sessionId, { turnKey, turn: editing.turn, quote: editing.quote, text })
            closeTurnComment()
          }}
        />
      )}
    </div>
  )
}

function Quote({ text }: { text: string }) {
  return (
    <blockquote className="line-clamp-3 border-l-2 border-line pl-2 text-meta whitespace-pre-wrap text-fg-muted">
      {text}
    </blockquote>
  )
}

function CommentEditor({
  turn,
  quote,
  onSave,
  onCancel,
}: {
  turn: number
  quote: string
  onSave(text: string): void
  onCancel(): void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  const save = (): void => {
    if (text.trim()) onSave(text)
  }
  return (
    <div data-turn-comment-editor className="flex flex-col gap-1.5 rounded-lg border border-line-card bg-surface p-2.5">
      <span className="text-meta font-medium text-fg-muted">{tr('turnComment.title', { n: turn })}</span>
      {quote && <Quote text={quote} />}
      <textarea
        ref={ref}
        value={text}
        rows={3}
        placeholder={tr('turnComment.placeholder')}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            save()
          }
        }}
        className="min-h-16 w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 text-ui text-fg outline-none placeholder:text-fg-faint focus:border-accent"
      />
      <div className="flex justify-end gap-1.5">
        <button type="button" className={ACTION} onClick={onCancel}>
          {tr('turnComment.cancel')}
        </button>
        <button
          type="button"
          disabled={!text.trim()}
          onClick={save}
          className="press rounded-md bg-accent px-2.5 py-1 text-meta text-accent-on disabled:opacity-50"
        >
          {tr('turnComment.save')}
        </button>
      </div>
    </div>
  )
}

function handedText(c: TurnComment): string | null {
  if (!c.handedTo) return null
  return c.handedTo.kind === 'ai'
    ? tr('turnComment.handedAi')
    : tr('turnComment.handedChannel', { channel: c.handedTo.channel, member: c.handedTo.member })
}

export function CommentCard({
  comment: c,
  ctx,
  onJump,
  sessionId,
}: {
  comment: TurnComment
  /** 在对话里时给出：可以交给 AI、交给频道成员 */
  ctx?: TurnCommentsValue | null
  /** 在右侧面板里时给出：点卡片跳到这一轮 */
  onJump?: () => void
  sessionId: string
}) {
  useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [toChannel, setToChannel] = useState(false)
  const handed = handedText(c)
  const toAi = async (): Promise<void> => {
    if (!ctx?.handoff) return
    setBusy(true)
    try {
      // 发出去时再按当前对话算一次编号（卡片显示的是上次渲染时的）
      const how = await ctx.handoff(commentMessage(withCurrentTurns([c], ctx.items())[0]))
      updateTurnComment(sessionId, c.id, { handedTo: { kind: 'ai' } })
      toast(tr(how === 'started' ? 'turnComment.started' : 'turnComment.queued'))
    } catch (err) {
      toast(tr('turnComment.failed', { reason: translateMessage((err as Error).message) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      data-turn-comment={c.id}
      className={cn(
        'group/comment flex flex-col gap-1.5 rounded-lg border border-line-card bg-surface p-2.5',
        c.resolved && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-1.5 text-meta text-fg-faint">
        {onJump ? (
          <button type="button" className="press font-medium text-fg-muted hover:text-fg" onClick={onJump}>
            {tr('turnComment.turnLabel', { n: c.turn })}
          </button>
        ) : (
          <span className="font-medium text-fg-muted">{tr('turnComment.turnLabel', { n: c.turn })}</span>
        )}
        <span>·</span>
        <time dateTime={new Date(c.at).toISOString()}>{new Date(c.at).toLocaleString()}</time>
        {c.resolved && <span className="text-success">· {tr('turnComment.resolved')}</span>}
        {handed && <span className="min-w-0 truncate text-accent-fg">· {handed}</span>}
      </div>
      {c.quote && <Quote text={c.quote} />}
      <p className="text-ui whitespace-pre-wrap text-fg-body">{c.text}</p>
      <div className="-ml-1 flex flex-wrap items-center gap-0.5">
        {!c.resolved && ctx?.handoff && (
          <button type="button" className={ACTION} disabled={busy} onClick={() => void toAi()}>
            <Send size={12} strokeWidth={1.75} />
            {tr('turnComment.toAi')}
          </button>
        )}
        {!c.resolved && ctx && (
          <button type="button" className={ACTION} onClick={() => setToChannel(true)}>
            <Users size={12} strokeWidth={1.75} />
            {tr('turnComment.toChannel')}
          </button>
        )}
        <button
          type="button"
          className={ACTION}
          onClick={() => updateTurnComment(sessionId, c.id, { resolved: !c.resolved })}
        >
          {c.resolved ? <RotateCcw size={12} strokeWidth={1.75} /> : <Check size={12} strokeWidth={1.75} />}
          {tr(c.resolved ? 'turnComment.reopen' : 'turnComment.resolve')}
        </button>
        <span className="flex-1" />
        <IconButton
          icon={Trash2}
          label={tr('turnComment.delete')}
          size={24}
          iconSize={12}
          onClick={() => removeTurnComment(sessionId, c.id)}
        />
      </div>
      {toChannel && ctx && <ToChannelDialog comment={c} ctx={ctx} onClose={() => setToChannel(false)} />}
    </div>
  )
}

/** 交给频道成员：选本机频道和里面的 AI 成员，发一条 @ 他的消息 */
function ToChannelDialog({ comment, ctx, onClose }: { comment: TurnComment; ctx: TurnCommentsValue; onClose(): void }) {
  useI18n()
  const toast = useToast()
  const channels = useChannels(s => s.channels)
  const members = useChannels(s => s.members)
  const choices = useMemo(
    () =>
      channels.filter(
        c =>
          c.scope === 'local' &&
          !c.archivedAt &&
          c.memberIds.some(id => members.some(m => m.id === id && m.kind === 'agent')),
      ),
    [channels, members],
  )
  const [channelId, setChannelId] = useState(choices[0]?.id ?? '')
  const channel = choices.find(c => c.id === channelId) ?? null
  const agents = useMemo(
    () => members.filter(m => m.kind === 'agent' && !!channel?.memberIds.includes(m.id)),
    [members, channel],
  )
  const [memberId, setMemberId] = useState('')
  const member = agents.find(m => m.id === memberId) ?? agents[0] ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <ConfirmDialog
      title={tr('turnComment.channelTitle')}
      description={
        choices.length ? (
          <div className="flex flex-col gap-3 pt-1">
            <label className="flex flex-col gap-1 text-meta text-fg-muted">
              {tr('turnComment.channel')}
              <Select
                label={tr('turnComment.channel')}
                value={channelId}
                options={choices.map(c => ({ value: c.id, label: `#${c.name}` }))}
                onChange={id => {
                  setChannelId(id)
                  setMemberId('')
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-meta text-fg-muted">
              {tr('turnComment.member')}
              <Select
                label={tr('turnComment.member')}
                value={member?.id ?? ''}
                options={agents.map(m => ({ value: m.id, label: m.name }))}
                onChange={setMemberId}
              />
            </label>
            <Quote text={comment.quote ? `${comment.quote}\n\n${comment.text}` : comment.text} />
          </div>
        ) : (
          tr('turnComment.noChannels')
        )
      }
      confirmLabel={tr('turnComment.send')}
      cancelLabel={tr('turnComment.cancel')}
      confirmDisabled={!channel || !member}
      busy={busy}
      error={error}
      onCancel={onClose}
      onConfirm={() => {
        if (!channel || !member) return
        setBusy(true)
        setError(null)
        channelActions
          .postText(channel.id, channelRequest(withCurrentTurns([comment], ctx.items())[0], member.name, ctx.title))
          .then(() => {
            updateTurnComment(ctx.sessionId, comment.id, {
              handedTo: { kind: 'channel', channel: channel.name, member: member.name },
            })
            toast(tr('turnComment.sent', { channel: channel.name }))
            onClose()
          })
          .catch((err: Error) => setError(translateMessage(err.message)))
          .finally(() => setBusy(false))
      }}
    />
  )
}
