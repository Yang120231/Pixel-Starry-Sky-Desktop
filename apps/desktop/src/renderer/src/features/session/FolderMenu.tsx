// 输入框上方的「📁 项目 ▾」，对话已经开始时（docs/ui/machines-workspaces.md §9）：对话固定在这个文件夹，不能换
// （GitHub #11：原来在这里选别的文件夹会悄悄新开一个空对话、原来的从眼前消失）。点开是几项和这个文件夹有关的操作，
// 换文件夹都是另开新对话，当前这个原样留着
import { useState } from 'react'
import { ChevronDown, Copy, Folder, FolderOpen, FolderTree, SquarePen } from 'lucide-react'
import { cn, Popover, PopoverItem, useToast } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { isDemo } from '@/data'
import { openWorkspacePicker } from '@/features/machines/store'
import { paneActions } from '@/features/panes/store'
import { showFiles } from '@/features/files/store'
import { OpenInButton } from '@/features/editor/OpenInButton'
import { ToolbarContext, useToolbarState } from '@/features/layout/ToolbarContext'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

// header：会话页顶栏标题前的「项目 分支 ▾」按钮（docs/ui/session-title-row-mockup.html 方案 C），菜单往下开
export function FolderMenu({
  name,
  path,
  target,
  header,
}: {
  name: string
  path: string
  target: WorkspaceRef | null
  header?: { branch: string | null }
}) {
  useI18n()
  const toast = useToast()
  const toolbar = useToolbarState()
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  const pick = (fn: () => void) => () => {
    close()
    fn()
  }
  return (
    <span className="relative inline-flex min-w-0">
      <button
        type="button"
        data-composer-project={header ? undefined : ''}
        data-header-project={header ? '' : undefined}
        data-folder-menu
        aria-haspopup="menu"
        aria-expanded={open}
        title={path}
        onMouseDown={e => open && e.stopPropagation()}
        onClick={() => setOpen(v => !v)}
        className={cn(
          header
            ? 'no-drag inline-flex h-[26px] min-w-0 items-center gap-1.5 rounded-sm border border-line px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg'
            : 'inline-flex min-w-0 items-center gap-1 rounded px-1 hover:bg-hover hover:text-fg',
          open && 'bg-hover text-fg',
        )}
      >
        <Folder size={13} className="shrink-0" />
        <span className="truncate">{name}</span>
        {header?.branch && <span className="shrink-0 font-mono text-fg-muted">{header.branch}</span>}
        <ChevronDown size={12} className={cn('shrink-0', header && 'text-fg-faint')} />
      </button>
      <Popover open={open} onClose={close} side={header ? 'bottom' : 'top'} offset={header ? 6 : 8} className="w-72">
        <p className="px-2 pt-1 pb-1.5 text-meta break-all text-fg-muted">
          {tr('machines.folder.fixed', { path: path || name })}
        </p>
        <PopoverItem
          icon={<FolderOpen size={15} strokeWidth={1.5} className="text-fg-secondary" />}
          onClick={pick(() => openWorkspacePicker({ fresh: true }))}
        >
          {tr('machines.folder.newElsewhere')}
        </PopoverItem>
        <PopoverItem
          icon={<SquarePen size={15} strokeWidth={1.5} className="text-fg-secondary" />}
          onClick={pick(() => paneActions.open(null))}
        >
          {tr('machines.folder.newHere')}
        </PopoverItem>
        <div role="separator" className="my-1 border-t border-line-subtle" />
        <PopoverItem
          icon={<FolderTree size={15} strokeWidth={1.5} className="text-fg-secondary" />}
          disabled={!target && !isDemo}
          onClick={pick(() => showFiles(target ?? undefined))}
        >
          {tr('machines.folder.showFiles')}
        </PopoverItem>
        <ToolbarContext.Provider value={{ ...toolbar, closeMenu: close }}>
          <OpenInButton placement="composer" />
        </ToolbarContext.Provider>
        <PopoverItem
          icon={<Copy size={15} strokeWidth={1.5} className="text-fg-secondary" />}
          disabled={!target && !isDemo}
          onClick={pick(() => {
            if (isDemo || !target) {
              void navigator.clipboard?.writeText(path).catch(() => undefined)
              toast(tr('machines.folder.copied'))
              return
            }
            void window
              .pixelsky!.files.copyPath(target)
              .then(() => toast(tr('machines.folder.copied')))
              .catch((e: Error) => toast(translateMessage(e.message)))
          })}
        >
          {tr('machines.folder.copyPath')}
        </PopoverItem>
      </Popover>
    </span>
  )
}
