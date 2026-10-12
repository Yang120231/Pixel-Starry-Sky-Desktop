import type { ReactNode } from 'react'
import { ChevronDown, Folder, GitBranch, Monitor } from 'lucide-react'
import { composerStatus } from '@/data'
import type { StatusBarController } from '@/features/engine'
import { useI18n } from '@/i18n/I18nProvider'
import { openMachineManager, openWorkspacePicker, useMachines } from '@/features/machines/store'

/**
 * 输入框外部左上方的机器与项目 / 分支；欢迎页保留项目选择入口。
 * 传入 live 时显示真实项目（欢迎页可以切换 / 添加项目）；不传时是演示数据。
 */
export function ComposerStatusBar({ live, extra }: { live?: StatusBarController; extra?: ReactNode }) {
  const { text } = useI18n()
  const machines = useMachines(),
    machine = machines.machines.find(m => m.id === machines.currentId)
  return (
    <div
      data-composer-workspace
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-1.5 pb-2 text-meta text-fg-faint"
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
      {extra && <span className="ml-auto flex shrink-0 items-center">{extra}</span>}
    </div>
  )
}

/**
 * All project entry points share the same directory / Git worktree picker.
 * 已经开始的会话绑定在创建时的工作区：只显示是哪个，不能在这里换（issue #11；在这里选别的工作区并不会挪会话，
 * 而是另开一个会话，容易误会）。换工作区在新会话或侧栏里做。
 */
function ProjectPicker({ live }: { live: StatusBarController }) {
  const { text } = useI18n()
  const { project } = live
  if (!live.canPickProject)
    return (
      <span data-composer-project title={project?.path} className="inline-flex min-w-0 items-center gap-1 px-1">
        <Folder size={13} className="shrink-0" />
        <span className="truncate">{project?.name ?? text('选择项目文件夹')}</span>
      </span>
    )
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
