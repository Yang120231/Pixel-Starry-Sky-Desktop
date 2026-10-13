import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  FileClock,
  FilePlus,
  FolderPlus,
  RefreshCw,
  ChevronsDownUp,
  Search,
  Copy,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react'
import { ActionMenu } from '@/ui/ActionMenu'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { IconButton, Spinner, cn } from '@/ui'
import { useEngineState } from '@/features/engine'
import { isDemo, projects as demoProjects } from '@/data'
import { useActiveWorkspace } from '@/features/editor/target'
import { OPEN_FILES_EVENT, dirtyFile, openFile, openFilesUnder, removeFile, renameOpenFiles, useFiles } from './store'
import type { DirectoryListing, FileEntry, WorkspaceRef } from '../../../../shared/types/workspace'
import { demo } from '@/data/demo'
import { requestFileHistory } from '@/features/panel/git/fileHistory'
const pathKey = (path: string): string => {
  const p = path.replaceAll('\\', '/').replace(/\/$/, '')
  return window.pixelsky?.platform === 'win32' ? p.toLowerCase() : p
}

const TreeExpansion = createContext({ version: 0, expanded: false })
/** 状态上色方式：default 只有字母着色（原样）；vscode 文件名也上色，目录名后加小点（代码模式） */
export type FileTreeStatusColors = 'default' | 'vscode'
const TreeColors = createContext<FileTreeStatusColors>('default')
/** 状态字母的颜色：M 黄、A 和 ? 绿、D 和 ! 红 */
const statusTone = (status: string): string =>
  status === 'M' ? 'text-warn' : status === 'D' || status === '!' ? 'text-danger' : 'text-success'
/** 在项目根目录新建时，让折叠的 ProjectRoot 展开（detail 是 refKey） */
const EXPAND_ROOT_EVENT = 'pixelsky:file-tree-expand-root'

// 新建 / 重命名 / 删除（docs/ui/files-search-terminal-pins.md §3）
const refKey = (ref: WorkspaceRef): string => ref.projectId ?? ref.sessionId ?? ''
const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')
const join2 = (parent: string, name: string): string => (parent ? `${parent}/${name}` : name)
const NAME_OK = (name: string): boolean => !!name && !/[\\/:*?"<>|]/.test(name) && !/[ .]$/.test(name)
interface EditState {
  mode: 'file' | 'folder' | 'rename'
  ref: WorkspaceRef
  /** 新建时是所在文件夹；重命名时是原路径的上级 */
  parent: string
  /** 重命名的原路径 */
  path?: string
}
const TreeOps = createContext<{
  editing: EditState | null
  edit(next: EditState | null): void
  submit(name: string): Promise<void>
  remove(ref: WorkspaceRef, entry: FileEntry): void
}>({ editing: null, edit: () => {}, submit: async () => {}, remove: () => {} })

/** 树里就地输入名称：回车确认，Esc 或离开取消；出错时留在输入框并显示原因 */
function NameInput({ initial, depth, folder }: { initial: string; depth: number; folder: boolean }) {
  const ops = useContext(TreeOps)
  const [value, setValue] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    // 重命名文件时只选中扩展名前面的部分
    const dot = folder ? -1 : initial.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [folder, initial])
  const commit = async (): Promise<void> => {
    const name = value.trim()
    if (name === initial && initial) return ops.edit(null)
    if (!NAME_OK(name)) return setError(tr('errors.files.invalidName'))
    setBusy(true)
    try {
      await ops.submit(name)
    } catch (e) {
      setError(translateMessage((e as Error).message))
      setBusy(false)
      input.current?.focus()
    }
  }
  return (
    <div style={{ paddingLeft: 10 + Math.min(depth, 20) * 12 }} className="pr-2">
      <div className="flex min-h-7 items-center gap-1.5">
        <ChevronRight size={12} className="invisible shrink-0" />
        {folder ? (
          <Folder size={14} className="shrink-0 text-fg-muted" />
        ) : (
          <File size={14} className="shrink-0 text-fg-muted" />
        )}
        <input
          ref={input}
          value={value}
          disabled={busy}
          aria-label={tr(folder ? 'workspace.folderName' : 'workspace.fileName')}
          aria-invalid={!!error}
          onChange={e => {
            setValue(e.target.value)
            setError('')
          }}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              ops.edit(null)
            }
          }}
          onBlur={() => {
            if (!busy && !error) ops.edit(null)
          }}
          className={cn(
            'h-6 min-w-0 flex-1 rounded-sm border bg-surface px-1.5 text-meta text-fg outline-none',
            error ? 'border-danger' : 'border-accent',
          )}
        />
      </div>
      {error && (
        <p role="alert" className="pb-1 pl-8 text-label text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
export function FileTree({
  requested,
  compact = false,
  scoped = false,
  heading = true,
  refreshKey = 0,
  statusColors = 'default',
  statuses: externalStatuses,
}: {
  requested: WorkspaceRef | null
  compact?: boolean
  scoped?: boolean
  /** 顶上写不写「文件」：右侧「文件」标签页里标签已经写了，不再重复（docs/ui/workbench-ux-3.md §2.3） */
  heading?: boolean
  /** 外部触发刷新：和内部的 revision 一起放进读目录和读状态的依赖里 */
  refreshKey?: number
  statusColors?: FileTreeStatusColors
  /** 外部传入的状态表（路径到状态字母）；传了就不再自己去读（演示模式不读状态） */
  statuses?: Record<string, string>
}) {
  useI18n()
  const projects = useEngineState(s => s.projects),
    active = useActiveWorkspace()
  const [query, setQuery] = useState(''),
    [revision, setRevision] = useState(0),
    [collapsed, setCollapsed] = useState(0),
    [expandAll, setExpandAll] = useState(false)
  const [requestedTarget, setRequestedTarget] = useState<{ path: string; name: string } | null>(null)
  const source = isDemo ? demoProjects.map(p => ({ id: p.id, name: p.name, path: p.name })) : projects
  useEffect(() => {
    let cancelled = false
    if (!requested || isDemo) {
      setRequestedTarget(null)
      return
    }
    void window.pixelsky!.files.target(requested).then(
      t => {
        if (!cancelled) setRequestedTarget(t)
      },
      () => {
        if (!cancelled) setRequestedTarget(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [requested?.sessionId, requested?.projectId])
  const chosenPath = requestedTarget?.path ?? active.path
  let roots = [...source]
  if (!isDemo && active.ref && active.path && !roots.some(p => pathKey(p.path) === pathKey(active.path)))
    roots.push({ id: 'history', path: active.path, name: active.name })
  if (!isDemo && requestedTarget && requested && !roots.some(p => pathKey(p.path) === pathKey(requestedTarget.path)))
    roots.push({ id: 'requested-history', path: requestedTarget.path, name: requestedTarget.name })
  if (scoped) {
    const ref = requested ?? active.ref
    const project = ref?.projectId ? source.find(p => p.id === ref.projectId) : null
    const resolved =
      project ??
      (requestedTarget
        ? { id: 'requested-history', ...requestedTarget }
        : !requested && active.ref
          ? { id: 'history', name: active.name, path: active.path }
          : isDemo
            ? source.find(p => p.id === ref?.projectId)
            : null)
    roots = resolved ? [resolved] : []
  }
  const rootRef = (project: { id: string }): WorkspaceRef =>
    project.id === 'history' ? active.ref! : project.id === 'requested-history' ? requested! : { projectId: project.id }
  // 新建 / 重命名 / 删除（docs/ui/files-search-terminal-pins.md §3）
  const [editing, setEditing] = useState<EditState | null>(null),
    [deleting, setDeleting] = useState<{ ref: WorkspaceRef; entry: FileEntry } | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false),
    [opError, setOpError] = useState('')
  const refresh = (): void => setRevision(n => n + 1)
  const rev = revision + refreshKey
  const startEdit = (next: EditState | null): void => {
    setOpError('')
    if (next && isDemo) return setOpError(tr('workspace.demoCannotModify'))
    // 在折叠的项目里新建时先展开（ProjectRoot 按这个事件展开）
    if (next && next.mode !== 'rename' && !next.parent)
      window.dispatchEvent(new CustomEvent(EXPAND_ROOT_EVENT, { detail: refKey(next.ref) }))
    setEditing(next)
  }
  const submit = async (name: string): Promise<void> => {
    const current = editing
    if (!current) return
    const bridge = window.pixelsky!.files
    if (current.mode === 'rename') {
      if (!current.path) return
      const { path } = await bridge.rename(current.ref, current.path, join2(current.parent, name))
      renameOpenFiles(current.ref, current.path, path)
    } else {
      const { path } = await bridge.create(current.ref, join2(current.parent, name), current.mode)
      if (current.mode === 'file') void openFile(current.ref, path).catch(() => {})
    }
    setEditing(null)
    refresh()
  }
  const confirmDelete = async (): Promise<void> => {
    if (!deleting) return
    setDeleteBusy(true)
    setOpError('')
    try {
      await window.pixelsky!.files.remove(deleting.ref, deleting.entry.path)
      for (const tab of openFilesUnder(deleting.ref, deleting.entry.path)) removeFile(tab.id)
      setDeleting(null)
      refresh()
    } catch (e) {
      setOpError((e as Error).message)
    } finally {
      setDeleteBusy(false)
    }
  }
  const remove = (ref: WorkspaceRef, entry: FileEntry): void => {
    setOpError('')
    if (isDemo) return setOpError(tr('workspace.demoCannotModify'))
    setDeleting({ ref, entry })
  }
  const single = roots.length === 1 ? rootRef(roots[0]) : null
  const dirtyCount = deleting ? openFilesUnder(deleting.ref, deleting.entry.path).filter(dirtyFile).length : 0
  return (
    <TreeExpansion.Provider value={{ version: collapsed, expanded: expandAll }}>
      <TreeColors.Provider value={statusColors}>
        <TreeOps.Provider value={{ editing, edit: startEdit, submit, remove }}>
          <div
            data-file-tree
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              compact && 'w-52 shrink-0 flex-none border-r border-line-layout',
            )}
          >
            <div className="flex h-10 shrink-0 items-center gap-1 px-2">
              <span className="flex-1 px-1 text-ui font-medium text-fg">{heading && tr('files.FileTree.files')}</span>
              {single && (
                <>
                  <IconButton
                    icon={FilePlus}
                    size={26}
                    iconSize={14}
                    label={tr('workspace.newFile')}
                    onClick={() => startEdit({ mode: 'file', ref: single, parent: '' })}
                  />
                  <IconButton
                    icon={FolderPlus}
                    size={26}
                    iconSize={14}
                    label={tr('workspace.newFolder')}
                    onClick={() => startEdit({ mode: 'folder', ref: single, parent: '' })}
                  />
                </>
              )}
              <IconButton
                icon={RefreshCw}
                size={26}
                iconSize={14}
                label={tr('files.FileTree.refreshFilesAndGit')}
                onClick={() => setRevision(n => n + 1)}
              />
              <IconButton
                icon={ChevronsDownUp}
                size={26}
                iconSize={14}
                label={tr(expandAll ? 'workspace.collapseAll' : 'workspace.expandAll')}
                onClick={() => {
                  setExpandAll(v => !v)
                  setCollapsed(n => n + 1)
                }}
              />
            </div>
            <label className="mx-2 mb-2 flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-subtle px-2">
              <Search size={14} className="shrink-0 text-fg-muted" />
              <input
                aria-label={tr('files.FileTree.filterFilesByName')}
                placeholder={tr('files.FileTree.filterFilesByName2')}
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-meta text-fg outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label={tr('files.FileTree.clearFileFilter')}
                  onClick={() => setQuery('')}
                  className="text-meta text-fg-muted"
                >
                  {tr('files.FileTree.clear')}
                </button>
              )}
            </label>
            {opError && !deleting && (
              <p role="alert" className="mx-3 mb-2 text-label text-danger">
                {translateMessage(opError)}
              </p>
            )}
            <div data-file-tree-scroll className="min-h-0 flex-1 overflow-auto pb-3">
              {roots.length ? (
                roots.map(project => (
                  <ProjectRoot
                    key={project.id}
                    name={project.name}
                    refTarget={rootRef(project)}
                    autoOpen={
                      scoped ||
                      pathKey(project.path) === pathKey(chosenPath) ||
                      (isDemo && (requested?.projectId ?? active.ref?.projectId) === project.id)
                    }
                    query={query}
                    revision={rev}
                    collapsed={collapsed}
                    externalStatuses={externalStatuses}
                  />
                ))
              ) : (
                <p className="px-4 py-6 text-meta text-fg-muted">{tr('files.FileTree.noProjectYetAdd')}</p>
              )}
            </div>
          </div>
          {deleting && (
            <ConfirmDialog
              title={tr('workspace.deleteTitle', { name: deleting.entry.name })}
              description={
                <div className="flex flex-col gap-2">
                  <p>{tr('workspace.deleteHint')}</p>
                  {dirtyCount > 0 && (
                    <p className="text-danger">{tr('workspace.deleteDirty', { count: dirtyCount })}</p>
                  )}
                </div>
              }
              confirmLabel={deleteBusy ? tr('workspace.deleting') : tr('workspace.deleteEntry')}
              cancelLabel={tr('workspace.cancel')}
              busy={deleteBusy}
              error={opError ? translateMessage(opError) : null}
              danger
              onConfirm={() => void confirmDelete()}
              onCancel={() => {
                setDeleting(null)
                setOpError('')
              }}
            />
          )}
        </TreeOps.Provider>
      </TreeColors.Provider>
    </TreeExpansion.Provider>
  )
}

function ProjectRoot({
  name,
  refTarget,
  autoOpen,
  query,
  revision,
  collapsed,
  externalStatuses,
}: {
  name: string
  refTarget: WorkspaceRef
  autoOpen: boolean
  query: string
  revision: number
  collapsed: number
  externalStatuses?: Record<string, string>
}) {
  useI18n()
  const [expanded, setExpanded] = useState(autoOpen),
    [fetchedStatuses, setStatuses] = useState<Record<string, string>>({}),
    [results, setResults] = useState<DirectoryListing | null>(null),
    [error, setError] = useState(''),
    [searching, setSearching] = useState(false)
  const statuses = externalStatuses ?? fetchedStatuses,
    hasExternal = !!externalStatuses
  const expansion = useContext(TreeExpansion),
    ops = useContext(TreeOps)
  const [menu, setMenu] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null)
  const initial = useRef(true)
  useEffect(() => {
    if (autoOpen) setExpanded(true)
  }, [autoOpen])
  const rootKey = refKey(refTarget)
  useEffect(() => {
    const open = (e: Event): void => {
      if ((e as CustomEvent<string>).detail === rootKey) setExpanded(true)
    }
    window.addEventListener(EXPAND_ROOT_EVENT, open)
    return () => window.removeEventListener(EXPAND_ROOT_EVENT, open)
  }, [rootKey])
  useEffect(() => {
    if (initial.current) initial.current = false
    else setExpanded(expansion.expanded)
  }, [collapsed])
  useEffect(() => {
    let cancelled = false
    if (!expanded || isDemo || externalStatuses) return
    void window.pixelsky!.files.status(refTarget).then(
      s => {
        if (!cancelled) setStatuses(s)
      },
      () => {
        if (!cancelled) setStatuses({})
      },
    )
    return () => {
      cancelled = true
    }
  }, [expanded, revision, hasExternal, refTarget.projectId, refTarget.sessionId])
  useEffect(() => {
    let cancelled = false
    setError('')
    setResults(null)
    if (!query.trim() || !expanded) {
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      const result = isDemo
        ? Promise.resolve({
            entries: Object.keys(demo().files.contents)
              .filter(p => p.toLowerCase().includes(query.toLowerCase()))
              .map(path => ({ path, name: path.split('/').pop()!, kind: 'file' as const })),
            truncated: false,
          })
        : window.pixelsky!.files.search(refTarget, query)
      void result.then(
        r => {
          if (!cancelled) {
            setResults(r)
            setSearching(false)
          }
        },
        e => {
          if (!cancelled) {
            setError(e.message)
            setSearching(false)
          }
        },
      )
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, expanded, revision, refTarget.projectId, refTarget.sessionId])
  return (
    <section className="border-t border-line-layout">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={tr('files.FileTree.project', { p0: expanded ? '收起' : '展开', p1: name })}
        onClick={() => setExpanded(v => !v)}
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, trigger: e.currentTarget })
        }}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-ui text-fg hover:bg-hover"
      >
        <ChevronRight
          size={13}
          className={cn('shrink-0 transition-transform duration-(--dur-fast)', expanded && 'rotate-90')}
        />
        <Folder size={14} className="text-accent-fg" />
        <span className="truncate font-medium">{name}</span>
      </button>
      {expanded &&
        (query.trim() ? (
          <div className="px-2 pb-1">
            {searching && (
              <p className="flex items-center gap-2 px-2 py-2 text-meta text-fg-muted">
                <Spinner size={12} />
                {tr('files.FileTree.filtering')}
              </p>
            )}
            {error && (
              <p role="status" className="px-2 py-2 text-meta text-danger">
                {translateMessage(error)}
              </p>
            )}
            {results?.entries.map(e => (
              <FileRow
                key={e.path}
                entry={e}
                refTarget={refTarget}
                depth={0}
                revision={revision}
                statuses={statuses}
                showPath
              />
            ))}
            {results && !results.entries.length && (
              <p className="px-2 py-2 text-meta text-fg-muted">{tr('files.FileTree.noMatchingFiles')}</p>
            )}
            {results?.truncated && (
              <p className="px-2 py-2 text-label text-fg-muted">{tr('files.FileTree.showingPartialResultsNarrow')}</p>
            )}
            <p className="px-2 py-1 text-label text-fg-faint">{tr('files.FileTree.filterByNameSkips')}</p>
          </div>
        ) : (
          <Directory refTarget={refTarget} path="" depth={0} revision={revision} statuses={statuses} />
        ))}
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={name}
          onClose={() => {
            setMenu(null)
            menu.trigger.focus({ preventScroll: true })
          }}
          actions={[
            {
              label: tr('workspace.newFile'),
              icon: FilePlus,
              run: () => ops.edit({ mode: 'file', ref: refTarget, parent: '' }),
            },
            {
              label: tr('workspace.newFolder'),
              icon: FolderPlus,
              run: () => ops.edit({ mode: 'folder', ref: refTarget, parent: '' }),
            },
          ]}
        />
      )}
    </section>
  )
}

function Directory({
  refTarget,
  path,
  depth,
  revision,
  statuses,
}: {
  refTarget: WorkspaceRef
  path: string
  depth: number
  revision: number
  statuses: Record<string, string>
}) {
  useI18n()
  const { editing } = useContext(TreeOps)
  const creating =
    editing && editing.mode !== 'rename' && editing.parent === path && refKey(editing.ref) === refKey(refTarget)
      ? editing
      : null
  const [list, setList] = useState<DirectoryListing | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setList(null)
    setError('')
    const result = isDemo ? Promise.resolve(demo().files.directory(path)) : window.pixelsky!.files.list(refTarget, path)
    void result.then(
      r => {
        if (!cancelled) setList(r)
      },
      e => {
        if (!cancelled) setError(e.message)
      },
    )
    return () => {
      cancelled = true
    }
  }, [path, revision, refTarget.projectId, refTarget.sessionId])
  if (error)
    return (
      <p role="status" className="px-4 py-2 text-meta text-danger">
        {translateMessage(error)}
      </p>
    )
  if (!list)
    return (
      <p className="flex items-center gap-2 px-4 py-2 text-meta text-fg-muted">
        <Spinner size={12} />
        {tr('editor.FileEditor.loadingFile')}
      </p>
    )
  return (
    <div>
      {creating && <NameInput key={creating.mode} initial="" depth={depth} folder={creating.mode === 'folder'} />}
      {list.entries.map(entry => (
        <FileRow
          key={entry.path}
          entry={entry}
          refTarget={refTarget}
          depth={depth}
          revision={revision}
          statuses={statuses}
        />
      ))}
      {!list.entries.length && !creating && (
        <p className="px-4 py-1 text-meta text-fg-faint">{tr('files.FileTree.emptyFolder')}</p>
      )}
      {list.truncated && (
        <p className="px-4 py-1 text-meta text-fg-muted">{tr('files.FileTree.largeDirectoryShowingFirst')}</p>
      )}
    </div>
  )
}

function FileRow({
  entry,
  refTarget,
  depth,
  revision,
  statuses,
  showPath,
}: {
  entry: FileEntry
  refTarget: WorkspaceRef
  depth: number
  revision: number
  statuses: Record<string, string>
  showPath?: boolean
}) {
  useI18n()
  const expansion = useContext(TreeExpansion)
  const vscode = useContext(TreeColors) === 'vscode'
  const [expanded, setExpanded] = useState(
      expansion.expanded && entry.kind === 'directory' && !entry.linked && depth < 20,
    ),
    [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null)
  useEffect(() => {
    if (expansion.version) setExpanded(expansion.expanded && entry.kind === 'directory' && !entry.linked && depth < 20)
  }, [expansion.version])
  const ops = useContext(TreeOps),
    mine = !!ops.editing && refKey(ops.editing.ref) === refKey(refTarget)
  const renaming = mine && ops.editing!.mode === 'rename' && ops.editing!.path === entry.path
  // 在这个文件夹里新建时先展开它
  const creatingInside = mine && ops.editing!.mode !== 'rename' && ops.editing!.parent === entry.path
  useEffect(() => {
    if (creatingInside) setExpanded(true)
  }, [creatingInside])
  const files = useFiles(),
    active = files.tabs.find(t => t.id === files.active)
  const sameTarget = active?.ref.projectId === refTarget.projectId && active?.ref.sessionId === refTarget.sessionId
  useEffect(() => {
    const reveal = (e: Event): void => {
      const detail = (e as CustomEvent<{ ref?: WorkspaceRef; path?: string }>).detail
      if (
        (!detail.ref ||
          (detail.ref.projectId === refTarget.projectId && detail.ref.sessionId === refTarget.sessionId)) &&
        detail?.path?.startsWith(entry.path + '/') &&
        entry.kind === 'directory'
      )
        setExpanded(true)
    }
    if (sameTarget && entry.kind === 'directory' && active?.path.startsWith(entry.path + '/')) setExpanded(true)
    window.addEventListener(OPEN_FILES_EVENT, reveal)
    return () => window.removeEventListener(OPEN_FILES_EVENT, reveal)
  }, [entry.path, entry.kind, active?.path, sameTarget])
  const targetRoot = useEngineState(s =>
    refTarget.projectId
      ? s.projects.find(p => p.id === refTarget.projectId)?.path
      : refTarget.sessionId
        ? (s.snapshots[refTarget.sessionId]?.record.cwd ??
          s.sessions.find(x => x.record.id === refTarget.sessionId)?.record.cwd)
        : undefined,
  )
  const sameRef =
    (active?.ref.projectId === refTarget.projectId && active?.ref.sessionId === refTarget.sessionId) ||
    (!!active?.root && !!targetRoot && pathKey(active.root) === pathKey(targetRoot))
  const status =
    statuses[entry.path] ??
    (entry.kind === 'directory' && Object.keys(statuses).some(p => p.startsWith(entry.path + '/')) ? '•' : '')
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = row.current,
      list = el?.closest<HTMLElement>('[data-file-tree-scroll]')
    if (!el || !list || !sameRef || active?.path !== entry.path) return
    const r = el.getBoundingClientRect(),
      bounds = list.getBoundingClientRect()
    if (r.top < bounds.top) list.scrollTop -= bounds.top - r.top
    else if (r.bottom > bounds.bottom) list.scrollTop += r.bottom - bounds.bottom
  }, [active?.path, sameRef, entry.path])
  const Icon = entry.kind === 'directory' ? (expanded ? FolderOpen : Folder) : File
  return (
    <div>
      {renaming ? (
        <NameInput initial={entry.name} depth={depth} folder={entry.kind === 'directory'} />
      ) : (
        <div
          ref={row}
          onContextMenu={e => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, trigger: e.currentTarget.querySelector('button')! })
          }}
          className={cn(
            'group/file flex min-w-0 items-center rounded-md pr-2 hover:bg-hover',
            active?.path === entry.path && sameRef && 'bg-selected',
          )}
          style={{ paddingLeft: 10 + Math.min(depth, 20) * 12 }}
        >
          <button
            type="button"
            aria-label={`${entry.kind === 'directory' ? (expanded ? tr('files.FileTree.collapseFolder') : tr('files.FileTree.expandFolder')) : tr('files.FileTree.openFile')} ${entry.path}`}
            aria-expanded={entry.kind === 'directory' ? expanded : undefined}
            title={entry.path + (entry.linked ? tr('files.FileTree.link') : '')}
            onClick={() =>
              entry.kind === 'directory'
                ? setExpanded(v => !v)
                : void openFile(refTarget, entry.path).catch(e => setError(e.message))
            }
            className={cn(
              'flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left text-meta',
              active?.path === entry.path && sameRef
                ? 'text-accent-fg'
                : vscode && status && entry.kind !== 'directory'
                  ? statusTone(status)
                  : 'text-fg-secondary',
            )}
          >
            <ChevronRight
              size={12}
              className={cn('shrink-0', entry.kind !== 'directory' && 'invisible', expanded && 'rotate-90')}
            />
            <Icon size={14} className="shrink-0 text-fg-muted" />
            <span className={cn('min-w-0 truncate', !(vscode && entry.kind === 'directory' && status) && 'flex-1')}>
              {showPath ? entry.path : entry.name}
            </span>
            {vscode && entry.kind === 'directory' && status && (
              <span
                aria-hidden
                title={tr('files.FileTree.gitStatus', { p0: status })}
                className="mr-auto size-1.5 shrink-0 rounded-full bg-warn"
              />
            )}
            {status && !(vscode && entry.kind === 'directory') && (
              <span
                title={tr('files.FileTree.gitStatus', { p0: status })}
                className={cn(
                  'shrink-0 text-label',
                  vscode ? statusTone(status) : status === 'D' || status === '!' ? 'text-danger' : 'text-success',
                )}
              >
                {status}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label={tr('files.FileTree.copyFilePath', { p0: entry.path })}
            title={tr('files.FileTree.copyPath')}
            className="ml-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted opacity-0 hover:bg-hover focus:opacity-100 group-hover/file:opacity-100"
            onClick={() => {
              if (isDemo) setError(tr('files.FileTree.demoModeCannotCopy'))
              else void window.pixelsky!.files.copyPath(refTarget, entry.path).catch(e => setError(e.message))
            }}
          >
            <Copy size={11} />
          </button>
        </div>
      )}
      {error && (
        <p role="status" className="px-4 text-label text-danger">
          {translateMessage(error)}
        </p>
      )}
      {expanded && (
        <Directory refTarget={refTarget} path={entry.path} depth={depth + 1} revision={revision} statuses={statuses} />
      )}
      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          label={entry.name}
          onClose={() => {
            setMenu(null)
            menu.trigger.focus({ preventScroll: true })
          }}
          actions={[
            ...(entry.kind === 'directory'
              ? [
                  {
                    label: tr('workspace.newFile'),
                    icon: FilePlus,
                    run: () => ops.edit({ mode: 'file', ref: refTarget, parent: entry.path }),
                  },
                  {
                    label: tr('workspace.newFolder'),
                    icon: FolderPlus,
                    run: () => ops.edit({ mode: 'folder', ref: refTarget, parent: entry.path }),
                  },
                ]
              : []),
            {
              label: tr('workspace.renameEntry'),
              icon: Pencil,
              run: () => ops.edit({ mode: 'rename', ref: refTarget, parent: parentOf(entry.path), path: entry.path }),
            },
            {
              label: tr('workspace.deleteEntry'),
              icon: Trash2,
              danger: true,
              run: () => ops.remove(refTarget, entry),
            },
            ...(entry.kind === 'directory'
              ? []
              : [
                  {
                    label: tr('git.history.file.show'),
                    icon: FileClock,
                    separator: true,
                    run: () => requestFileHistory({ ref: refTarget, path: entry.path, base: 'workspace' }),
                  },
                ]),
            {
              label: tr('panes.PaneView.copyFilePath'),
              icon: Copy,
              separator: entry.kind === 'directory',
              run: () => {
                if (!isDemo) void window.pixelsky!.files.copyPath(refTarget, entry.path).catch(e => setError(e.message))
              },
            },
            {
              label: tr('panes.PaneView.openWithExternalEditor'),
              icon: ExternalLink,
              run: () => {
                if (!isDemo)
                  void window.pixelsky!.editor.open(refTarget, undefined, entry.path).catch(e => setError(e.message))
              },
            },
          ]}
        />
      )}
    </div>
  )
}
