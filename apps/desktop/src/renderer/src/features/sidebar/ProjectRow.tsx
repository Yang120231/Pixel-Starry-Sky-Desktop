import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ellipsis, FolderOpen, PencilLine, SquareArrowOutUpRight, Trash2, type LucideIcon } from 'lucide-react'
import { normalizeProjectName, PROJECT_NAME_LIMIT } from '@pixelsky/protocol'
import { cn, useToast } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { translateMessage } from '@/i18n/core'
import { isLive, removeProject, renameProject } from '@/features/engine'
import { machineOf } from '@/features/machines/store'
import type { Project } from '@/data'

/**
 * 侧栏项目行：点击展开 / 收起；右键、⋯ 按钮、ContextMenu 键或 Shift+F10 打开项目菜单。
 * 重命名只改显示名，移除只把项目移出列表（磁盘文件和会话记录保留）。见 docs/ui/sidebar-compact-controls.md §9。
 */
export function ProjectRow({
  project,
  open,
  onToggle,
  icon: Icon,
  trailing,
}: {
  project: Project
  open: boolean
  onToggle: () => void
  icon: LucideIcon
  trailing?: ReactNode
}) {
  const { t } = useI18n()
  const toast = useToast()
  const row = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null),
    [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<'rename' | 'remove' | null>(null)
  const remote = machineOf(project.id) !== 'local'

  const close = (restore = true): void => {
    setPosition(null)
    setCoords(null)
    if (restore) button.current?.focus({ preventScroll: true })
  }
  const show = (x?: number, y?: number): void => {
    const rect = row.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ x: x ?? rect.right - 180, y: y ?? rect.bottom + 4 })
  }
  useLayoutEffect(() => {
    if (!position || !menu.current) return
    const rect = menu.current.getBoundingClientRect()
    setCoords({
      x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)),
    })
    const down = (e: PointerEvent): void => {
      if (!menu.current?.contains(e.target as Node) && !row.current?.contains(e.target as Node)) close(false)
    }
    const scroll = (e: Event): void => {
      if (!menu.current?.contains(e.target as Node)) close(false)
    }
    const resize = (): void => close(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [position])
  useLayoutEffect(() => {
    if (coords)
      menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({ preventScroll: true })
  }, [coords])

  const run = (action: () => void): void => {
    close(false)
    if (!isLive) {
      toast(t('project.demo'))
      return
    }
    action()
  }
  const external = (task: () => Promise<unknown>): void =>
    run(() => void task().catch(error => toast(translateMessage((error as Error).message) || t('project.retry'))))
  const item =
    'flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-ui hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div
      ref={row}
      data-project-row={project.id}
      onContextMenu={event => {
        event.preventDefault()
        show(event.clientX, event.clientY)
      }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          show()
        }
      }}
      className="group/project relative flex h-8 min-w-0 shrink-0 items-center rounded-md text-list text-fg-secondary transition-colors hover:bg-hover"
    >
      <button
        ref={button}
        type="button"
        title={project.name}
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-md pl-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <Icon size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
      </button>
      <div className="relative flex h-full min-w-6 shrink-0 items-center justify-end pr-1">
        <span
          className={cn(
            'flex items-center group-hover/project:invisible group-focus-within/project:invisible',
            position && 'invisible',
          )}
        >
          {trailing}
        </span>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={!!position}
          aria-label={t('project.actions', { name: project.name })}
          title={t('project.menu')}
          onClick={() => (position ? close() : show())}
          className={cn(
            'absolute right-1 flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-selected hover:text-fg focus-visible:ring-2 focus-visible:ring-accent',
            position ? 'visible' : 'invisible group-hover/project:visible group-focus-within/project:visible',
          )}
        >
          <Ellipsis size={16} strokeWidth={1.5} />
        </button>
      </div>
      {position &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={t('project.menu')}
            data-project-menu
            className="pop-in no-drag fixed z-[70] min-w-44 rounded-lg border border-line-card bg-popover p-1 text-fg shadow-menu"
            style={{
              left: coords?.x ?? position.x,
              top: coords?.y ?? position.y,
              visibility: coords ? 'visible' : 'hidden',
            }}
            onKeyDown={event => {
              const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')],
                i = items.indexOf(document.activeElement as HTMLButtonElement)
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                close()
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                items[
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (i + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
                ]?.focus({ preventScroll: true })
              }
              if (event.key === 'Tab') {
                event.preventDefault()
                close()
              }
            }}
          >
            <button role="menuitem" onClick={() => run(() => setDialog('rename'))} className={item}>
              <PencilLine size={15} strokeWidth={1.5} />
              {t('project.rename')}
            </button>
            <button
              role="menuitem"
              disabled={remote}
              title={remote ? t('project.remoteUnavailable') : undefined}
              onClick={() => external(() => window.pixelsky!.files.reveal({ projectId: project.id }))}
              className={item}
            >
              <FolderOpen size={15} strokeWidth={1.5} />
              {t('project.reveal')}
            </button>
            <button
              role="menuitem"
              disabled={remote}
              title={remote ? t('project.remoteUnavailable') : undefined}
              onClick={() => external(() => window.pixelsky!.editor.open({ projectId: project.id }))}
              className={item}
            >
              <SquareArrowOutUpRight size={15} strokeWidth={1.5} />
              {t('project.openEditor')}
            </button>
            <div role="separator" className="my-1 border-t border-line-subtle" />
            <button role="menuitem" onClick={() => run(() => setDialog('remove'))} className={cn(item, 'text-danger')}>
              <Trash2 size={15} strokeWidth={1.5} />
              {t('project.remove')}
            </button>
          </div>,
          document.body,
        )}
      {dialog === 'rename' && (
        <RenameProjectDialog
          name={project.name}
          onSave={name => renameProject(project.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'remove' && (
        <RemoveProjectDialog
          name={project.name}
          onRemove={() => removeProject(project.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** 共用的提交状态：进行中禁止重复提交，失败时把宿主错误翻译后留在对话框里。 */
function useSubmit(onClose: () => void) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const submit = async (task: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await task()
      onClose()
    } catch (e) {
      setError(translateMessage((e as Error).message) || t('project.retry'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, submit }
}

function RenameProjectDialog({
  name,
  onSave,
  onClose,
}: {
  name: string
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(name)
  const { busy, error, setError, submit } = useSubmit(onClose)
  const save = (): void => {
    let next: string
    try {
      next = normalizeProjectName(value)
    } catch (e) {
      setError(translateMessage((e as Error).message))
      return
    }
    if (next === name) {
      onClose()
      return
    }
    void submit(() => onSave(next))
  }
  return (
    <ConfirmDialog
      title={t('project.renameTitle')}
      focusInput
      description={
        <>
          <p>{t('project.renameDescription')}</p>
          <label className="mt-4 flex flex-col gap-2">
            <span>{t('project.name')}</span>
            <input
              data-project-name
              value={value}
              disabled={busy}
              aria-invalid={!!error}
              onChange={event => {
                setValue(event.target.value)
                setError(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  save()
                }
              }}
              className="w-full min-w-0 rounded-md border border-line bg-surface px-3 py-2 text-ui text-fg outline-none focus:border-accent-line focus:ring-2 focus:ring-composer-ring"
            />
            <span className="text-right text-meta tabular-nums text-fg-muted">
              {Array.from(value).length} / {PROJECT_NAME_LIMIT}
            </span>
          </label>
        </>
      }
      busy={busy}
      error={error}
      confirmLabel={t(busy ? 'project.busy' : 'project.save')}
      cancelLabel={t('project.cancel')}
      onConfirm={save}
      onCancel={onClose}
    />
  )
}

function RemoveProjectDialog({
  name,
  onRemove,
  onClose,
}: {
  name: string
  onRemove: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const { busy, error, submit } = useSubmit(onClose)
  return (
    <ConfirmDialog
      title={t('project.removeTitle', { name })}
      description={<p>{t('project.removeDescription')}</p>}
      busy={busy}
      error={error}
      danger
      confirmLabel={t(busy ? 'project.busy' : 'project.removeConfirm')}
      cancelLabel={t('project.cancel')}
      onConfirm={() => void submit(onRemove)}
      onCancel={onClose}
    />
  )
}
