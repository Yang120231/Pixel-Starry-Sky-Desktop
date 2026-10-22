import { ArrowDown, ArrowUp } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { HeaderBranch } from '@/features/session/HeaderBranch'
import { useGitStatus } from '@/features/panel/git/summary'
import { requestGitAction } from '@/features/panel/git/GitPanel'
import { codingLayout } from '../layoutStore'
import { useCodingWorkspace } from '../workspace'

const COUNT_BUTTON =
  'flex h-6 items-center gap-0.5 rounded-md px-1 text-meta text-fg-muted hover:bg-hover hover:text-fg'

/** 顶栏的分支名 + ↑ahead ↓behind；不是 Git 仓库或没有项目时不显示 */
export function BranchWidget() {
  useI18n()
  const { ref } = useCodingWorkspace()
  const status = useGitStatus(ref)
  if (!ref || !status || status.repo === false) return null
  const go = (action: 'push' | 'pull'): void => {
    codingLayout.showLeft('git')
    requestGitAction(action)
  }
  return (
    <div data-branch-widget className="flex max-w-60 min-w-0 items-center gap-0.5">
      <HeaderBranch workspace={ref} label={status.branch ?? ''} variant="header" />
      {status.ahead > 0 && (
        <button
          type="button"
          className={COUNT_BUTTON}
          title={tr('coding.top.branch.ahead', { p0: status.ahead })}
          aria-label={tr('coding.top.branch.ahead', { p0: status.ahead })}
          onClick={() => go('push')}
        >
          <ArrowUp size={12} strokeWidth={1.5} />
          {status.ahead}
        </button>
      )}
      {status.behind > 0 && (
        <button
          type="button"
          className={COUNT_BUTTON}
          title={tr('coding.top.branch.behind', { p0: status.behind })}
          aria-label={tr('coding.top.branch.behind', { p0: status.behind })}
          onClick={() => go('pull')}
        >
          <ArrowDown size={12} strokeWidth={1.5} />
          {status.behind}
        </button>
      )}
    </div>
  )
}
