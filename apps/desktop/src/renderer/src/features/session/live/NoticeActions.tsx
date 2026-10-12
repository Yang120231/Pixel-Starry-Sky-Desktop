import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 错误卡片下面的一键按钮（docs/ui/source-switch.md §3.5）：只给最近一轮的错误，按错误类型和会话的额度来源给下一步。
// 按钮只发请求（features/engine/sourceActions.ts），切换额度来源的确认由同一会话的输入框负责。不会自动切换。
import { ENGINES, type SessionRecord } from '@pixelsky/protocol'
import { demoRetry, requestSourceAction, type SourceAction } from '@/features/engine'
import { isDemo } from '@/data'
import { useSettings } from '@/features/settings/SettingsProvider'
import { requestLogFocus } from '@/features/logs/focus'
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
  get 'edit-provider'() {
    return tr('customApi.editEndpoint')
  },
  get retry() {
    return tr('session.live.NoticeActions.retry')
  },
}

function actionsFor(
  kind: ErrorKind,
  record: Pick<SessionRecord, 'platform' | 'provider'>,
  engine: SessionRecord['engine'],
): SourceAction[] {
  // 自定义 API（docs/ui/custom-api.md §3.3）：失败不自动改用别的来源，按钮让用户自己选
  if (record.provider && !record.platform) {
    const platform: SourceAction[] = ENGINES[engine].caps.platformSwitch ? ['use-platform'] : []
    if (kind === 'auth') return ['edit-provider', ...platform, 'use-self']
    if (kind === 'balance' || kind === 'busy') return ['edit-provider', ...platform]
    return ['open-menu', 'edit-provider']
  }
  if (record.platform) {
    if (kind === 'auth') return ['sign-in', 'use-self']
    if (kind === 'balance') return ['open-account', 'open-menu', 'use-self']
    return ['open-menu', 'use-self']
  }
  // 自有：只有能接平台额度的引擎（能力表 platformSwitch）才给「改用平台」
  return ENGINES[engine].caps.platformSwitch ? ['use-platform'] : []
}

/** 卡片下面最后一个按钮「查看日志」：打开设置 › 日志，筛到这个会话这一轮（docs/ui/logging.md §3.2） */
export function NoticeActions({
  record,
  text,
  turnStart,
  retry = false,
}: {
  record: SessionRecord
  text: string
  /** 给「重试」：会话空闲、队列也空着时（没发出去的消息在队列里有自己的重试） */
  retry?: boolean
  /** 这一轮用户消息的时间；没有时按十分钟前 */
  turnStart: number | null
}) {
  useI18n()
  const settings = useSettings()
  const kind = classifyError(text)
  const actions: SourceAction[] = [
    ...(retry ? (['retry'] as const) : []),
    ...(kind ? actionsFor(kind, record, record.engine) : []),
  ]
  const viewLogs = () => {
    requestLogFocus(record.id, turnStart ?? Date.now() - 10 * 60_000)
    settings.openSettings('logs')
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[27px]">
      {actions.map(a => (
        <button
          key={a}
          type="button"
          onClick={() => (a === 'retry' && isDemo ? demoRetry(record.id) : requestSourceAction(record.id, a))}
          className="press h-7 rounded-md border border-line bg-surface px-2.5 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
        >
          {LABEL[a]}
        </button>
      ))}
      <button
        type="button"
        onClick={viewLogs}
        className="press h-7 rounded-md px-2.5 text-meta text-fg-muted hover:bg-hover hover:text-fg"
      >
        {tr('logs.viewLogs')}
      </button>
    </div>
  )
}
