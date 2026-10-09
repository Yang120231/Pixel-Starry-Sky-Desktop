import { Logo } from '@/components/ui'
import type { ComposerController, StatusBarController } from '@/engine'
import { Composer } from './Composer'
import { ComposerArea } from './ComposerArea'
import { useI18n } from '@/i18n/I18nProvider'

/**
 * 欢迎页：新会话、没有对话时显示，Logo + 标题 + 副标题 + 输入框，整体居中略偏上（design-refresh.md §5.3）。
 * live / status 不传时是演示模式。
 */
export function WelcomeView({ live, status, draftKey }: { live?: ComposerController; status?: StatusBarController; draftKey?: string }) {
  const { text } = useI18n()
  const needProject = !!status && !status.project
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-app pb-[12vh]">
      <div className="flex w-full min-w-0 flex-col">
        <div className="flex flex-col items-center px-6 text-center">
          <Logo size={44} />
          <h2 className="mt-5 text-title text-fg">{text('有什么可以帮你？')}</h2>
          <p className="mt-2 text-ui text-fg-muted">
            {needProject ? text('先选择一个项目文件夹，然后描述你要做的事') : text('在这台电脑上开始一个新任务')}
          </p>
        </div>
        <div className="mt-7">
          <ComposerArea>
            <Composer live={live} status={status} draftKey={draftKey} autoFocus={!!live} />
          </ComposerArea>
        </div>
      </div>
    </div>
  )
}
