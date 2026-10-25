import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useState } from 'react'
import { Workflow } from 'lucide-react'
import { Button, Popover, Segmented, Select, useToast } from '@/ui'
import type { Channel, ChannelMember } from '@/data/types'
import { channelActions } from './store'

/** 频道输入框上方的「新建流程」（docs/ui/channels-pipeline.md §4.5）：自己写一张草稿，或让某个成员拆 */
export function NewFlowButton({ channel, members }: { channel: Channel; members: readonly ChannelMember[] }) {
  useI18n()
  const toast = useToast()
  const agents = members.filter(m => m.kind === 'agent')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'manual' | 'plan'>('manual')
  const [title, setTitle] = useState('')
  const [plannerId, setPlannerId] = useState('')
  const [busy, setBusy] = useState(false)
  const planner = agents.some(a => a.id === plannerId) ? plannerId : (agents[0]?.id ?? '')
  const ready = agents.length > 0 && title.trim() !== ''

  const create = () => {
    const text = title.trim()
    setBusy(true)
    channelActions
      .flow(
        channel.id,
        mode === 'plan'
          ? { type: 'create', title: text, planner: { memberId: planner, request: text } }
          : {
              type: 'create',
              title: text,
              steps: [{ id: 's1', title: '', memberId: agents[0].id, deps: [], kind: 'work' }],
            },
      )
      .then(id => {
        setOpen(false)
        setTitle('')
        void channelActions.focusMessage(channel.id, id)
      })
      .catch((e: unknown) =>
        toast(tr('channels.flow.failed', { error: translateMessage((e as Error)?.message ?? String(e)) })),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="conversation-inset conversation-reading relative flex shrink-0 justify-start pb-1.5">
      <Button variant="ghost" icon={Workflow} className="h-7 px-2 text-meta" onClick={() => setOpen(o => !o)}>
        {tr('channels.flow.new')}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} side="top" role="dialog" className="w-80 p-3">
        <div className="flex flex-col gap-2.5">
          <Segmented
            label={tr('channels.flow.new')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'manual', label: tr('channels.flow.manual') },
              { value: 'plan', label: tr('channels.flow.plan') },
            ]}
          />
          {mode === 'plan' && (
            <Select
              label={tr('channels.flow.planner')}
              value={planner}
              options={agents.map(a => ({ value: a.id, label: a.name }))}
              onChange={setPlannerId}
            />
          )}
          <input
            autoFocus
            aria-label={mode === 'plan' ? tr('channels.flow.request') : tr('channels.flow.titleLabel')}
            placeholder={mode === 'plan' ? tr('channels.flow.request') : tr('channels.flow.titleLabel')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready && !busy) create()
            }}
            className="h-8 rounded-md border border-line bg-surface px-2 text-ui text-fg outline-none focus:border-accent"
          />
          <Button variant="primary" className="self-end" disabled={!ready || busy} onClick={create}>
            {tr('channels.flow.create')}
          </Button>
        </div>
      </Popover>
    </div>
  )
}
