import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 错误卡片下面的一键按钮（docs/ui/source-switch.md §3.5）：只给最近一轮的错误，按错误类型和会话的额度来源给下一步。
// 按钮只发请求（features/engine/sourceActions.ts），切换额度来源的确认由同一会话的输入框负责。不会自动切换。
import type { SessionRecord } from '@pixelsky/protocol'
import { requestSourceAction, type SourceAction } from '@/features/engine'
import { classifyError, type ErrorKind } from './errorKind'

const LABEL: Record<SourceAction, string> = {
  get 'open-menu'() {
    return tr('session.live.NoticeActions.changeRoute')
  },
  get 'use-self'() {
    return tr('session.live.NoticeActions.continueWithOwnAccount')
  },
  get 'use-platform'() {
    return tr('session.live.NoticeActions.continueWithPlatform')
  },
  get 'open-account'() {
    return tr('session.live.NoticeActions.viewAccount')
  },
  get 'sign-in'() {
    return tr('session.live.NoticeActions.signInAgain')
  },
}

function actionsFor(kind: ErrorKind, platform: boolean, engine: SessionRecord['engine']): SourceAction[] {
  if (platform) {
    if (kind === 'auth') return ['sign-in', 'use-self']
    if (kind === 'balance') return ['open-account', 'open-menu', 'use-self']
    return ['open-menu', 'use-self']
  }
  // 自有：平台目前只支持 Claude Code
  return engine === 'claude' ? ['use-platform'] : []
}

export function NoticeActions({ record, text }: { record: SessionRecord; text: string }) {
  useI18n()
  const kind = classifyError(text)
  if (!kind) return null
  const actions = actionsFor(kind, !!record.platform, record.engine)
  if (actions.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[27px]">
      {actions.map(a => (
        <button
          key={a}
          type="button"
          onClick={() => requestSourceAction(record.id, a)}
          className="press h-7 rounded-md border border-line bg-surface px-2.5 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
        >
          {LABEL[a]}
        </button>
      ))}
    </div>
  )
}
