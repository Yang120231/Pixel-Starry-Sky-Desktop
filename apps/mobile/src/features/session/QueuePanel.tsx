// 消息队列（docs/mobile-remote.md §17 第 2 项、§26，规则同桌面 QueuedMessages）：输入框上面浮着排着的消息，每条是浅灰圆角块（图标 + 状态 + 一行字），
// 点一条弹出能做的事：插队 / 重试、引导、上移、下移、撤回（撤回的文字放回输入框）、关掉；
// 断线自动重连中的那条：立即重连、停止（队列暂停时是继续重连、停止）。
import { useState } from 'react'
import { ChevronDown, ChevronUp, CornerDownRight, ImageIcon, Pause } from 'lucide-react'
import type { QueuedMessage, SessionSnapshot } from '@pixelsky/protocol'
import type { DesktopLink } from '@/connection'
import {
  canDismiss,
  canSteer,
  isLimitWait,
  isPending,
  limitNote,
  isReconnecting,
  isSendFailure,
  queueErrorText,
  queueItems,
  queueLabel,
  queueMoveArg,
  queueTitle,
} from '@/data/queue'
import { L } from '@/i18n'
import { Button, Spinner, cn } from '@/ui'
import { ActionSheet, type SheetAction } from '@/ui/sheet'

/** 收起时露出几条 */
const COLLAPSED = 2

export function QueuePanel({
  link,
  sessionId,
  snapshot,
  canAct,
  onRecall,
}: {
  link: DesktopLink | undefined
  sessionId: string
  snapshot: SessionSnapshot
  canAct: boolean
  onRecall(text: string): void
}) {
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState<QueuedMessage | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = queueItems(snapshot)
  if (!items.length) return null
  const paused = snapshot.queuePaused || items.some(q => q.held)
  const shown = open ? items : items.slice(0, COLLAPSED)

  const run = async (id: string, method: string, ...args: unknown[]) => {
    if (!link || busy) return
    setBusy(id)
    setError(null)
    try {
      const result = await link.call(method, sessionId, ...args)
      if (method === 'engine:cancelQueued' && typeof result === 'string') onRecall(result)
    } catch (e) {
      setError(
        (e as Error).message === 'MOBILE_FORBIDDEN'
          ? L('这部手机是「只看」。', 'This phone is set to “View only”.')
          : queueErrorText((e as Error).message),
      )
    } finally {
      setBusy(null)
    }
  }

  const actionsFor = (q: QueuedMessage): SheetAction[] => {
    const before = link?.hello?.queueMoveBefore === true
    const up = queueMoveArg(snapshot.queue, items, q.id, -1, before)
    const down = queueMoveArg(snapshot.queue, items, q.id, 1, before)
    const list: SheetAction[] = []
    if (isLimitWait(q))
      return [
        {
          label: L('现在试一次', 'Try now'),
          hint: L(
            '不等额度恢复，现在就试；还是被限流的话算一次',
            'Try now instead of waiting; if still limited, it counts as a try',
          ),
          disabled: q.status === 'dispatching',
          onSelect: () => void run(q.id, 'engine:runQueuedNow', q.id),
        },
        {
          label: L('停止', 'Stop'),
          hint: L('不再等额度恢复，这条算发送失败', 'Stop waiting and mark this message as failed to send'),
          danger: true,
          onSelect: () => void run(q.id, 'engine:interrupt'),
        },
      ]
    if (isReconnecting(q))
      return [
        {
          label: snapshot.queuePaused ? L('继续重连', 'Resume reconnecting') : L('立即重连', 'Reconnect now'),
          hint: snapshot.queuePaused
            ? L('自动重连已暂停，现在接着连', 'Auto-reconnect is paused. Continue now')
            : L('不等倒计时，现在就连', 'Skip the countdown and connect now'),
          disabled: q.status === 'dispatching',
          onSelect: () => void run(q.id, 'engine:runQueuedNow', q.id),
        },
        {
          label: L('停止', 'Stop'),
          hint: L('不再自动重连，这条算发送失败', 'Stop reconnecting and mark this message as failed to send'),
          danger: true,
          onSelect: () => void run(q.id, 'engine:interrupt'),
        },
      ]
    if (!isPending(q))
      list.push(
        q.error
          ? {
              label: L('重试', 'Retry'),
              hint:
                q.status === 'uncertain'
                  ? L(
                      '核对过再重新执行，可能重复上次已经做过的操作',
                      'Check first: running it again may repeat what was already done',
                    )
                  : undefined,
              onSelect: () => void run(q.id, 'engine:runQueuedNow', q.id),
            }
          : {
              label: L('插队', 'Send now'),
              hint: L('停下当前这一轮，先发这条', 'Stop the current turn and send this first'),
              onSelect: () => void run(q.id, 'engine:runQueuedNow', q.id),
            },
      )
    if (canSteer(q, snapshot))
      list.push({
        label: L('引导', 'Steer'),
        hint: L('不停下，把这条作为补充说明交给正在做的这一轮', 'Add this to the current turn without stopping it'),
        onSelect: () => void run(q.id, 'engine:steerQueued', q.id, snapshot.turnId),
      })
    if (q.status === 'queued') {
      list.push(
        {
          label: L('上移', 'Move up'),
          disabled: up === null,
          onSelect: () => void run(q.id, 'engine:moveQueued', q.id, up),
        },
        {
          label: L('下移', 'Move down'),
          disabled: down === null,
          onSelect: () => void run(q.id, 'engine:moveQueued', q.id, down),
        },
      )
    }
    if (!isPending(q))
      list.push({
        label: L('撤回', 'Withdraw'),
        hint: L('文字放回输入框（图片不会放回）', "The text goes back to the input box (images don't)"),
        danger: true,
        onSelect: () => void run(q.id, 'engine:cancelQueued', q.id),
      })
    if (canDismiss(q))
      list.push({
        label: L('关掉', 'Dismiss'),
        hint: L(
          '不重发也不撤回：消息留在对话里标「未送达」，可以直接接着说',
          "Don't resend or withdraw: the message stays in the conversation marked “Not delivered”, and you can keep going",
        ),
        onSelect: () => void run(q.id, 'engine:dismissQueued', q.id),
      })
    return list
  }

  return (
    <section aria-label={L('消息队列', 'Message queue')} className="px-3 pt-2">
      <div className="flex min-h-8 items-center gap-1.5 px-1 text-meta text-fg-muted">
        {paused ? <Pause size={13} /> : <CornerDownRight size={13} />}
        <span>
          {queueTitle(items, snapshot.queuePaused)} · {items.length}
        </span>
        <span className="flex-1" />
        {paused && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!canAct || !!busy}
            onClick={() => void run('resume', 'engine:resumeQueue')}
            className="min-h-8 px-2 text-accent-fg"
          >
            {busy === 'resume' ? <Spinner size={12} /> : null}
            {L('继续队列', 'Resume queue')}
          </Button>
        )}
        {items.length > COLLAPSED && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex min-h-8 items-center gap-0.5 rounded-lg px-1.5 active:bg-hover"
          >
            {open ? L('收起', 'Collapse') : L(`全部 ${items.length} 条`, `All ${items.length}`)}
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      <div
        className={cn(
          'flex flex-col gap-1.5 pb-1',
          open && 'max-h-[calc(var(--app-height,100dvh)*0.35)] overflow-y-auto',
        )}
      >
        {shown.map(q => (
          <button
            key={q.id}
            type="button"
            disabled={!canAct}
            onClick={() => setMenu(q)}
            className="flex w-full items-start gap-2.5 rounded-2xl bg-subtle px-3.5 py-2.5 text-left active:bg-hover disabled:opacity-100"
          >
            <CornerDownRight size={16} className="mt-0.5 shrink-0 text-fg-faint" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-label">
                {isPending(q) || busy === q.id ? (
                  <Spinner size={10} className="text-fg-faint" />
                ) : (
                  <span className={cn('size-1.5 rounded-full', q.error ? 'bg-warn' : 'bg-fg-faint')} />
                )}
                <span className={q.error || isSendFailure(q) ? 'text-warn' : 'text-fg-muted'}>
                  {queueLabel(q, snapshot.queuePaused)}
                </span>
                {!!q.attachments?.length && (
                  <span className="flex items-center gap-0.5 text-fg-faint">
                    <ImageIcon size={12} /> {q.attachments.length}
                  </span>
                )}
              </span>
              <span className="truncate text-list text-fg-secondary">
                {q.text || L('（只有图片）', '(Images only)')}
              </span>
              {q.error && (
                <span className="truncate text-label text-warn">
                  {q.error.split('\n')[0]}
                  {!!q.reconnected &&
                    L(
                      ` · 已自动重连 ${q.reconnected} 次`,
                      ` · Auto-reconnected ${q.reconnected === 1 ? 'once' : `${q.reconnected} times`}`,
                    )}
                </span>
              )}
              {q.reconnect && isReconnecting(q) && (
                <span className="truncate text-label text-fg-faint">
                  {isLimitWait(q)
                    ? limitNote(q, snapshot.queuePaused)
                    : q.reconnect.reason || L('连接中断', 'Connection lost')}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="px-1 pb-1 text-meta text-danger">{error}</p>}
      {menu && (
        <ActionSheet
          title={menu.text.length > 40 ? menu.text.slice(0, 40) + '…' : menu.text || L('这条消息', 'This message')}
          actions={actionsFor(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  )
}
