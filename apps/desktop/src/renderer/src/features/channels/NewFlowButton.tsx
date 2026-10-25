import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useState } from 'react'
import { Workflow, X } from 'lucide-react'
import { Button, cn, IconButton, Popover, Segmented, Select, useToast } from '@/ui'
import type { Channel, ChannelMember } from '@/data/types'
import { channelActions } from './store'
import { applyTemplate, deleteTemplate, useFlowTemplates } from './flowTemplates'

/** 频道输入框上方的「新建流程」（docs/ui/channels-pipeline.md §4.5）：自己写一张草稿，或让某个成员拆 */
export function NewFlowButton({ channel, members }: { channel: Channel; members: readonly ChannelMember[] }) {
  useI18n()
  const toast = useToast()
  const agents = members.filter(m => m.kind === 'agent')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'manual' | 'plan' | 'tpl'>('manual')
  const templates = useFlowTemplates()
  const [tplId, setTplId] = useState('')
  const tpl = templates.find(t => t.id === tplId) ?? templates[0]
  const [title, setTitle] = useState('')
  const [plannerId, setPlannerId] = useState('')
  const [busy, setBusy] = useState(false)
  const planner = agents.some(a => a.id === plannerId) ? plannerId : (agents[0]?.id ?? '')
  const ready = agents.length > 0 && title.trim() !== '' && (mode !== 'tpl' || !!tpl)

  const create = () => {
    const text = title.trim()
    const applied = mode === 'tpl' && tpl ? applyTemplate(tpl, text, agents) : null
    setBusy(true)
    channelActions
      .flow(
        channel.id,
        applied
          ? {
              type: 'create',
              title: applied.title,
              steps: applied.steps,
              ...(applied.limits ? { limits: applied.limits } : {}),
              ...(applied.isolate !== undefined ? { isolate: applied.isolate } : {}),
            }
          : mode === 'plan'
            ? { type: 'create', title: text, planner: { memberId: planner, request: text } }
            : {
                type: 'create',
                title: text,
                steps: [{ id: 's1', title: '', memberId: agents[0].id, deps: [], kind: 'work' }],
              },
      )
      .then(id => {
        if (applied?.unmatched) toast(tr('channels.flow.tplUnmatched', { n: applied.unmatched }))
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
              { value: 'tpl', label: tr('channels.flow.useTpl') },
            ]}
          />
          {mode === 'tpl' &&
            (templates.length === 0 ? (
              <p className="text-meta text-fg-muted">{tr('channels.flow.tplEmpty')}</p>
            ) : (
              <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto" aria-label={tr('channels.flow.tplPick')}>
                {templates.map(t => (
                  <li key={t.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={t.id === tpl?.id}
                      onClick={() => setTplId(t.id)}
                      className={cn(
                        'h-7 min-w-0 flex-1 truncate rounded-md px-2 text-left text-ui',
                        t.id === tpl?.id ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-hover',
                      )}
                    >
                      {t.name}
                    </button>
                    <IconButton
                      icon={X}
                      iconSize={14}
                      size={24}
                      label={tr('channels.flow.tplDelete', { name: t.name })}
                      onClick={() => deleteTemplate(t.id)}
                    />
                  </li>
                ))}
              </ul>
            ))}
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
            aria-label={mode === 'manual' ? tr('channels.flow.titleLabel') : tr('channels.flow.request')}
            placeholder={mode === 'manual' ? tr('channels.flow.titleLabel') : tr('channels.flow.request')}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready && !busy) create()
            }}
            className="h-8 rounded-md border border-line bg-surface px-2 text-ui text-fg outline-none focus:border-accent"
          />
          <p className="text-meta text-fg-faint">{tr('channels.flow.notesHint')}</p>
          <Button variant="primary" className="self-end" disabled={!ready || busy} onClick={create}>
            {tr('channels.flow.create')}
          </Button>
        </div>
      </Popover>
    </div>
  )
}
