import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { MessageSquare, Plus } from 'lucide-react'
import { Button, useComingSoon } from '@/ui'

/** 没有频道时的整页空状态（docs/ui/channels.md §8） */
export function ChannelsEmpty() {
  useI18n()
  const comingSoon = useComingSoon()
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-subtle">
        <MessageSquare size={20} strokeWidth={1.5} className="text-fg-muted" />
      </span>
      <h2 className="mt-4 text-section font-semibold text-fg">{tr('channels.empty.title')}</h2>
      <p className="mt-2 max-w-[480px] text-list text-balance text-fg-muted">{tr('channels.empty.body')}</p>
      <p className="mt-1 max-w-[480px] text-meta text-balance text-fg-faint">{tr('channels.empty.later')}</p>
      <Button variant="primary" icon={Plus} className="mt-5" onClick={() => comingSoon(tr('channels.new'))}>
        {tr('channels.new')}
      </Button>
    </div>
  )
}
