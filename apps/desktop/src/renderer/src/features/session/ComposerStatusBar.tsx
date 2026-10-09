import { ChevronDown, Folder, GitBranch, Monitor } from 'lucide-react'
import { composerStatus } from '@/data'
import type { StatusBarController } from '@/features/engine'
import { useI18n } from '@/i18n/I18nProvider'
import { openMachineManager, openWorkspacePicker, useMachines } from '@/features/machines/store'

/**
 * 输入框外部左上方的机器与项目 / 分支；欢迎页保留项目选择入口。
 * 传入 live 时显示真实项目（欢迎页可以切换 / 添加项目）；不传时是演示数据。
 */
export function ComposerStatusBar({ live }: { live?: StatusBarController }) {
  const { text } = useI18n()
  const machines = useMachines(),
    machine = machines.machines.find(m => m.id === machines.currentId)
  return (
    <div
      data-composer-workspace
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-meta text-fg-faint"
    >
      <button
        type="button"
        onClick={openMachineManager}
        className="inline-flex shrink-0 items-center gap-1.5 hover:text-fg"
      >
        <Monitor size={13} strokeWidth={1.5} />
        {live ? (machine?.id === 'local' ? text('本机') : machine?.name) : text(composerStatus.machine)}
      </button>
      {live ? (
        <ProjectPicker live={live} />
      ) : (
        composerStatus.branch !== null && (
          <span className="inline-flex items-center gap-1">
            <GitBranch size={13} strokeWidth={1.5} />
            <span className="font-mono">{composerStatus.branch}</span>
          </span>
        )
      )}
    </div>
  )
}

/** All project entry points share the same directory / Git worktree picker. */
function ProjectPicker({ live }: { live: StatusBarController }) {
  const { text } = useI18n()
  const { project } = live
  return (
    <button
      type="button"
      onClick={openWorkspacePicker}
      title={project?.path}
      aria-label={text('切换工作区')}
      className="inline-flex min-w-0 items-center gap-1 rounded px-1 hover:bg-hover hover:text-fg"
    >
      <Folder size={13} className="shrink-0" />
      <span className="truncate">{project?.name ?? text('选择项目文件夹')}</span>
      <ChevronDown size={12} className="shrink-0" />
    </button>
  )
}
