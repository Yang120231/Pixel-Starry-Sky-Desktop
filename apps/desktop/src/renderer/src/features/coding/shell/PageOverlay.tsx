import { useI18n } from '@/i18n/I18nProvider'
import { usePage } from '@/features/layout/page'
import { ChannelsPage } from '@/features/channels/ChannelsPage'
import { TaskBoardPage } from '@/features/board/TaskBoardPage'
import { STRIPE_WIDTH } from '../layoutModel'

const noop = (): void => {}

/** 看板和频道盖住两条工具条之间的整块区域（D14）；下面的三栏保持挂载，由外层加 inert */
export function PageOverlay() {
  useI18n()
  const page = usePage()
  if (page === 'workbench') return null
  return (
    <div
      data-coding-overlay={page}
      className="absolute inset-y-0 z-10 flex min-w-0 bg-surface"
      style={{ left: STRIPE_WIDTH, right: STRIPE_WIDTH }}
    >
      {page === 'board' ? <TaskBoardPage /> : <ChannelsPage membersShown={false} onToggleMembers={noop} />}
    </div>
  )
}
