// 把已有的会话加入频道（docs/ui/import-collab.md 第 5 项②）：会话右键菜单「加入频道…」打开。只在正式模式用。
// 会话作为频道里的一个 AI 成员，频道派来的活就在这个会话里接着做，上下文都在；会话照常能自己聊。
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useMemo, useState } from 'react'
import { Select, useToast } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { setPage } from '@/features/layout/page'
import { channelActions, useChannels, useSessionBindings } from './store'

const INPUT =
  'w-full min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg outline-none focus:border-accent-line focus:ring-2 focus:ring-composer-ring'
const NEW = '__new__'

const errorText = (error: unknown) => translateMessage((error as Error)?.message ?? String(error))

/** 挂在应用根上：有要加入的会话时显示对话框 */
export function JoinChannelHost() {
  const joining = useChannels(s => s.joining)
  return joining ? (
    <JoinChannelDialog key={joining.sessionId} sessionId={joining.sessionId} title={joining.title} />
  ) : null
}

function JoinChannelDialog({ sessionId, title }: { sessionId: string; title: string }) {
  useI18n()
  const toast = useToast()
  const all = useChannels(s => s.channels)
  const members = useChannels(s => s.members)
  const bindings = useSessionBindings(sessionId)
  // 已经在里面的频道、团队频道、归档的不能选
  const options = useMemo(
    () =>
      all
        .filter(c => c.scope === 'local' && !c.archivedAt && !bindings.some(b => b.channelId === c.id))
        .map(c => ({ value: c.id, label: `# ${c.name}` })),
    [all, bindings],
  )
  // 这个会话已经是某个频道的成员：再加入别的频道时用同一个成员（名字不再问）
  const existing = bindings.length ? members.find(m => m.id === bindings[0].memberId) : undefined
  const [channelId, setChannelId] = useState<string>(options[0]?.value ?? NEW)
  const [channelName, setChannelName] = useState('')
  const [name, setName] = useState(existing?.name ?? title.slice(0, 20))
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creating = channelId === NEW
  const close = () => channelActions.closeJoin()
  const submit = () => {
    if (busy || (creating && !channelName.trim()) || (!existing && !name.trim())) return
    setBusy(true)
    setError(null)
    channelActions
      .joinSession({
        sessionId,
        channelId: creating ? null : channelId,
        ...(creating ? { channelName } : {}),
        name,
        instructions,
      })
      .then(({ channelId: joined }) => {
        close()
        const channel = creating ? channelName.trim() : (all.find(c => c.id === joined)?.name ?? '')
        toast(tr('channels.join.done', { channel, name: existing?.name ?? name.trim() }), {
          action: {
            label: tr('channels.join.open'),
            run: () => {
              setPage('channels')
              channelActions.select(joined)
            },
          },
        })
      })
      .catch(e => {
        setError(errorText(e))
        setBusy(false)
      })
  }
  return (
    <ConfirmDialog
      title={tr('channels.join.title')}
      confirmLabel={tr('channels.join.confirm')}
      cancelLabel={tr('channels.dialog.cancel')}
      busy={busy}
      error={error}
      focusInput
      confirmDisabled={(creating && !channelName.trim()) || (!existing && !name.trim())}
      dirty={!!instructions.trim() || !!channelName.trim()}
      onConfirm={submit}
      onCancel={close}
      description={
        <form
          data-join-channel
          className="flex flex-col gap-3"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="truncate text-meta text-fg-muted">{tr('channels.join.session', { title })}</p>
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-fg-muted">{tr('channels.join.channel')}</span>
            <Select
              label={tr('channels.join.channel')}
              value={channelId}
              options={[...options, { value: NEW, label: tr('channels.join.newChannel') }]}
              onChange={setChannelId}
              className="w-full"
            />
          </div>
          {creating && (
            <label className="flex flex-col gap-1.5">
              <span className="text-meta font-medium text-fg-muted">{tr('channels.join.channelName')}</span>
              <input
                value={channelName}
                maxLength={40}
                onChange={e => setChannelName(e.target.value)}
                className={INPUT}
              />
            </label>
          )}
          {existing ? (
            <p className="text-meta text-fg-muted">{tr('channels.join.sameMember', { name: existing.name })}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-meta font-medium text-fg-muted">{tr('channels.join.name')}</span>
                <input value={name} maxLength={40} onChange={e => setName(e.target.value)} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-meta font-medium text-fg-muted">{tr('channels.join.instructions')}</span>
                <textarea
                  value={instructions}
                  maxLength={2000}
                  rows={2}
                  placeholder={tr('channels.join.instructionsHint')}
                  onChange={e => setInstructions(e.target.value)}
                  className={`${INPUT} resize-none`}
                />
              </label>
            </>
          )}
          <p className="text-meta text-fg-muted">{tr('channels.join.hint')}</p>
          <button type="submit" hidden />
        </form>
      }
    />
  )
}
