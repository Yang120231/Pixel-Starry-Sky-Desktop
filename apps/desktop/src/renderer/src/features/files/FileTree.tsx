import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Folder, FolderOpen, File, RefreshCw, ChevronsDownUp, Search, Copy } from 'lucide-react'
import { ActionMenu } from '@/ui/ActionMenu'
import { IconButton, Spinner, cn } from '@/ui'
import { useEngineState } from '@/features/engine'
import { isDemo, projects as demoProjects } from '@/data'
import { useActiveWorkspace } from '@/features/editor/target'
import { OPEN_FILES_EVENT, openFile, useFiles } from './store'
import type { DirectoryListing, FileEntry, WorkspaceRef } from '../../../../shared/types/workspace'
import { demo } from '@/data/demo'
const pathKey = (path: string): string => {
  const p = path.replaceAll('\\', '/').replace(/\/$/, '')
  return window.pixelsky?.platform === 'win32' ? p.toLowerCase() : p
}

const TreeExpansion = createContext({ version: 0, expanded: false })
export function FileTree({
  requested,
  compact = false,
  scoped = false,
}: {
  requested: WorkspaceRef | null
  compact?: boolean
  scoped?: boolean
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
  return (
    <TreeExpansion.Provider value={{ version: collapsed, expanded: expandAll }}>
      <div
        data-file-tree
        className={cn('flex min-h-0 flex-1 flex-col', compact && 'w-52 shrink-0 flex-none border-r border-line-layout')}
      >
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
          <span className="flex-1 px-1 text-ui font-medium text-fg">{tr('files.FileTree.files')}</span>
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
        <div data-file-tree-scroll className="min-h-0 flex-1 overflow-auto pb-3">
          {roots.length ? (
            roots.map(project => (
              <ProjectRoot
                key={project.id}
                name={project.name}
                refTarget={
                  project.id === 'history'
                    ? active.ref!
                    : project.id === 'requested-history'
                      ? requested!
                      : { projectId: project.id }
                }
                autoOpen={
                  scoped ||
                  pathKey(project.path) === pathKey(chosenPath) ||
                  (isDemo && (requested?.projectId ?? active.ref?.projectId) === project.id)
                }
                query={query}
                revision={revision}
                collapsed={collapsed}
              />
            ))
          ) : (
            <p className="px-4 py-6 text-meta text-fg-muted">{tr('files.FileTree.noProjectYetAdd')}</p>
          )}
        </div>
      </div>
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
}: {
  name: string
  refTarget: WorkspaceRef
  autoOpen: boolean
  query: string
  revision: number
  collapsed: number
}) {
  useI18n()
  const [expanded, setExpanded] = useState(autoOpen),
    [statuses, setStatuses] = useState<Record<string, string>>({}),
    [results, setResults] = useState<DirectoryListing | null>(null),
    [error, setError] = useState(''),
    [searching, setSearching] = useState(false)
  const expansion = useContext(TreeExpansion)
  const initial = useRef(true)
  useEffect(() => {
    if (autoOpen) setExpanded(true)
  }, [autoOpen])
  useEffect(() => {
    if (initial.current) initial.current = false
    else setExpanded(expansion.expanded)
  }, [collapsed])
  useEffect(() => {
    let cancelled = false
    if (!expanded || isDemo) return
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
  }, [expanded, revision, refTarget.projectId, refTarget.sessionId])
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
      {!list.entries.length && <p className="px-4 py-1 text-meta text-fg-faint">{tr('files.FileTree.emptyFolder')}</p>}
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
  const [expanded, setExpanded] = useState(
      expansion.expanded && entry.kind === 'directory' && !entry.linked && depth < 20,
    ),
    [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null)
  useEffect(() => {
    if (expansion.version) setExpanded(expansion.expanded && entry.kind === 'directory' && !entry.linked && depth < 20)
  }, [expansion.version])
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
            active?.path === entry.path && sameRef ? 'text-accent-fg' : 'text-fg-secondary',
          )}
        >
          <ChevronRight
            size={12}
            className={cn('shrink-0', entry.kind !== 'directory' && 'invisible', expanded && 'rotate-90')}
          />
          <Icon size={14} className="shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 truncate">{showPath ? entry.path : entry.name}</span>
          {status && (
            <span
              title={tr('files.FileTree.gitStatus', { p0: status })}
              className={cn('shrink-0 text-label', status === 'D' || status === '!' ? 'text-danger' : 'text-success')}
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
            {
              label: tr('panes.PaneView.copyFilePath'),
              run: () => {
                if (!isDemo) void window.pixelsky!.files.copyPath(refTarget, entry.path).catch(e => setError(e.message))
              },
            },
            {
              label: tr('panes.PaneView.openWithExternalEditor'),
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
