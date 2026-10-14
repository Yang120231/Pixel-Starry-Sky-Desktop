import { useState } from 'react'
import { ChevronDown, FolderInput, FolderPlus } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Popover, PopoverItem } from '@/ui/Popover'
import { cn, useComingSoon } from '@/ui'
import { addProject, isLive, useSidebarData } from '@/features/engine'
import { importProjects } from '@/features/engine/store'
import { paneActions } from '@/features/panes/store'
import { newChatInProject, useCodingWorkspace } from '../workspace'

/** 顶栏的项目名（加粗 + ⌄）：点开列出所有项目，最后一行添加项目 */
export function ProjectWidget() {
  useI18n()
  const [open, setOpen] = useState(false)
  const { projects } = useSidebarData()
  const { projectId, name } = useCodingWorkspace()
  const comingSoon = useComingSoon()
  const choose = (id: string): void => {
    setOpen(false)
    if (id === projectId) return
    const project = projects.find(p => p.id === id)
    const latest = project?.sessions[0]
    if (latest) paneActions.open(latest.id)
    else if (!newChatInProject(id)) comingSoon(project?.name)
  }
  const add = (): void => {
    setOpen(false)
    if (isLive) void addProject()
    else comingSoon(tr('coding.top.project.add'))
  }
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        data-project-widget
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tr('coding.top.project.label')}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex h-7 max-w-52 items-center gap-1 rounded-md px-2 text-list font-semibold text-fg hover:bg-hover',
          open && 'bg-hover',
        )}
      >
        <span className="truncate">{name || tr('coding.top.project.none')}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-60">
        {projects.map(p => (
          <PopoverItem key={p.id} selected={p.id === projectId} onClick={() => choose(p.id)}>
            <span className="truncate">{p.name}</span>
          </PopoverItem>
        ))}
        <div className="my-1 h-px bg-line-layout" />
        <PopoverItem icon={<FolderPlus size={16} strokeWidth={1.5} className="shrink-0" />} onClick={add}>
          {tr('coding.top.project.add')}
        </PopoverItem>
        {isLive && (
          <PopoverItem
            icon={<FolderInput size={16} strokeWidth={1.5} className="shrink-0" />}
            onClick={() => {
              setOpen(false)
              importProjects()
            }}
          >
            {tr('projectImport.fromFolder')}
          </PopoverItem>
        )}
      </Popover>
    </div>
  )
}
