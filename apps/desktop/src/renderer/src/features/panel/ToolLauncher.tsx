// 右侧工作区全部标签关闭后的工具启动页（docs/ui/right-workspace-tools.md §2.2）：
// 按「代码 / 运行 / 项目」分组的工具卡片，下面是当前作用域最近打开过的文件。
import { FileText } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { CountBadge } from '@/ui'
import { relativeTime } from '@/features/engine'
import { openFile } from '@/features/files/store'
import { parseFileTab } from '@/features/panes/tree'
import { useInbox } from './inbox/useInbox'
import { useRecentFiles } from './recentFiles'
import { GROUP_KEY, hintKey, TOOL_GROUPS, TOOLS } from './tools'
import type { ToolId } from './workspaceState'

export function ToolLauncher({
  scope,
  showRecent,
  onSelect,
}: {
  scope: string
  /** 当前窗格有项目时才显示最近文件 */
  showRecent: boolean
  onSelect(id: ToolId): void
}) {
  const { t } = useI18n()
  const inboxCount = useInbox().length
  const recent = useRecentFiles(scope)
    .map(item => ({ ...item, file: parseFileTab(item.id) }))
    .filter(item => item.file !== null)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* 最多三列（每组最多三个工具），放大时卡片和最近文件列表对齐 */}
      <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-5 px-5 py-8">
        <p className="text-ui text-fg-secondary">{t('workspace.openTool')}</p>
        {TOOL_GROUPS.map(group => (
          <section key={group} className="flex flex-col gap-2">
            <h3 className="text-label text-fg-faint">{t(GROUP_KEY[group])}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
              {TOOLS.filter(tool => tool.group === group).map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  data-launch-tool={id}
                  className="flex min-w-0 flex-col items-start gap-1.5 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:bg-hover"
                  onClick={() => onSelect(id)}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <Icon size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate text-list font-medium text-fg">
                      {t(`workspace.${id}`)}
                    </span>
                    {id === 'tasks' && inboxCount > 0 && <CountBadge count={inboxCount} className="shrink-0" />}
                  </span>
                  <span className="line-clamp-2 text-meta text-fg-muted">{t(hintKey(id))}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {showRecent && recent.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="mb-1 text-label text-fg-faint">{t('workspace.recentFiles')}</h3>
            {recent.map(({ id, at, file }) => {
              const parts = file!.path.split('/'),
                name = parts.pop() ?? file!.path
              return (
                <button
                  key={id}
                  type="button"
                  data-recent-file={file!.path}
                  title={file!.path}
                  className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                  onClick={() => void openFile(file!.ref, file!.path)}
                >
                  <FileText size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
                  <span className="shrink-0 text-list text-fg">{name}</span>
                  <span className="min-w-0 flex-1 truncate text-meta text-fg-faint">{parts.join('/')}</span>
                  <span className="shrink-0 text-meta text-fg-faint">{relativeTime(at)}</span>
                </button>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}
