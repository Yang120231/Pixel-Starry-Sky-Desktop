import { useI18n } from '@/i18n/I18nProvider'
import type { WorkspaceRef } from '../../../preload/workspace'
import { FileTree } from './FileTree'

/** 文件内容在工作区标签中编辑；右侧面板保留浏览与筛选。 */
export function FilesPanel({ requested }: { requested: WorkspaceRef | null }) {
  useI18n()
  return (
    <div data-files-panel className="flex min-h-0 flex-1 flex-col">
      <FileTree requested={requested} />
    </div>
  )
}
