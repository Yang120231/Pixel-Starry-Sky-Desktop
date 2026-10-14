import { Plus, Undo2 } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Button } from '@/ui'
import type { OpenFile } from '@/features/files/store'
import { refKey } from '@/features/editor/target'
import { diffActions } from './gitDiffModel'
import { gitPanelKey, useGitFileActions, useWorkFile } from './gitDiffTabs'

/**
 * 样式 A（docs/ui/coding-mode.md §3.3.2）：文件有没暂存的改动时，标签顶上一条：哪个区 + 暂存 / 撤销更改。
 * 动作由 Git 面板执行（和「Git 对比」标签同一套 registerGitFileActions）；暂存后文件不在工作区改动里了，这一条自己消失
 */
export function GitWorkBar({ tab }: { tab: OpenFile }) {
  useI18n()
  const key = refKey(tab.ref)
  const work = useWorkFile(key, tab.path)
  const { actions, busy } = useGitFileActions(gitPanelKey(key))
  if (!work || !actions) return null
  const can = diffActions(work.area)
  return (
    <div
      data-git-work-bar={work.area}
      className="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-3 text-meta text-fg-muted"
    >
      <span className="min-w-0 truncate">{tr(`git.section.${work.area}`)}</span>
      <span className="flex-1" />
      {can.stage && (
        <Button
          variant="outline"
          icon={Plus}
          className="h-6 px-2 text-meta"
          disabled={busy}
          onClick={() => actions.stage(work.path)}
        >
          {tr('git.stage')}
        </Button>
      )}
      {can.discard && (
        <Button
          variant="outline"
          icon={Undo2}
          className="h-6 px-2 text-meta"
          disabled={busy}
          onClick={() => actions.discard(work.path, work.area as 'unstaged' | 'untracked')}
        >
          {tr('git.discard')}
        </Button>
      )}
    </div>
  )
}
