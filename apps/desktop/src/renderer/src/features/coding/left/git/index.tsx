import { GitPanel } from '@/features/panel/git/GitPanel'
import { useGitSummary } from '@/features/panel/git/summary'
import { useCodingWorkspace } from '../../workspace'

/** 左栏「Git」：直接挂原来的 Git 面板；左栏窄，diff 会自动退成行内显示 */
export function GitView({ visible }: { visible: boolean }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <GitPanel active={visible} />
    </div>
  )
}

/** 工具条 Git 图标上的角标：有改动的文件数；不是仓库时 0 */
export function useGitBadge(): number {
  const { ref } = useCodingWorkspace()
  return useGitSummary(ref)?.changed ?? 0
}
