import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import type { Channel, ChannelMember } from '@/data/types'

/** 输入框上方一行：不 @ 的话会怎样（有牵头：先出分工提案，点开始才派活；没有：只是留言），@ 成员直接派 */
export function LeadHint({ channel, members }: { channel: Channel; members: readonly ChannelMember[] }) {
  useI18n()
  if (!members.some(m => m.kind === 'agent')) return null
  const lead = channel.lead ? members.find(m => m.id === channel.lead) : undefined
  return (
    <p className="conversation-inset conversation-reading shrink-0 truncate pb-1 text-meta text-fg-faint">
      {lead ? tr('channels.hint.lead', { name: lead.name }) : tr('channels.hint.noLead')}
    </p>
  )
}
