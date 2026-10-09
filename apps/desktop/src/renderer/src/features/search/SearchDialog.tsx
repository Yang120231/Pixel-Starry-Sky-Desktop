import { ENGINES, searchSnippet, searchTerms } from '@pixelsky/protocol'
import { setCurrentProject } from '@/features/engine/store'
import { paneActions } from '@/features/panes/store'
import { requestTask } from '@/features/panel/taskNavigation'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { CornerDownLeft, FileText, Folder, MessageSquare, Search, SquareTerminal, X } from 'lucide-react'
import type { SearchQuery, SearchResponse, SearchResult, SearchScope } from '@pixelsky/protocol'
import { IconButton, Spinner, cn } from '@/ui'
import { OPEN_SESSION_EVENT, bridge, useEngineState } from '@/features/engine'
import { isDemo } from '@/data'
import { ProjectFilter } from './ProjectFilter'
import { demo } from '@/data/demo'
import { openFile } from '@/features/files/store'
import { useActiveWorkspace } from '@/features/editor/target'
import { demoFileHits, searchFiles, type FileHit, type FileHits } from './fileSearch'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

/** 「项目文件」只在界面里，不发给会话搜索 */
type Scope = SearchScope | 'files'

const SCOPES: Array<{ id: Scope; name: string }> = [
  {
    id: 'all',
    get name() {
      return tr('search.SearchDialog.allContent')
    },
  },
  {
    id: 'titles',
    get name() {
      return tr('search.SearchDialog.conversationTitles')
    },
  },
  {
    id: 'messages',
    get name() {
      return tr('search.SearchDialog.messages')
    },
  },
  {
    id: 'tools',
    get name() {
      return tr('search.SearchDialog.toolContent')
    },
  },
  {
    id: 'files',
    get name() {
      return tr('search.SearchDialog.projectFiles')
    },
  },
]
const noFiles: FileHits = { hits: [], truncated: false }
let requestSequence = 0
const emptyResponse: SearchResponse = { requestId: 0, results: [], truncated: false, partial: false, sessionCount: 0 }

function Fragments({ parts }: { parts: SearchResult['snippet'] }) {
  useI18n()
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent-fg">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

export function SearchDialog({
  inputRef,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
}) {
  useI18n()
  const [text, setText] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [fileHits, setFileHits] = useState<FileHits>(noFiles)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [response, setResponse] = useState(emptyResponse)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [composing, setComposing] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const projects = useEngineState(s => s.projects)
  const options = isDemo ? demo().search.projects : projects
  // 搜文件的项目：选了项目筛选就用它，否则用当前窗格的项目
  const workspace = useActiveWorkspace()
  const fileRef: WorkspaceRef | null = projectId ? { projectId } : workspace.ref
  const fileRefKey = fileRef ? (fileRef.projectId ?? 'session:' + fileRef.sessionId) : ''
  const openHit = (hit: FileHit) => {
    void openFile(hit.ref, hit.path, hit.line ?? undefined, hit.column ?? 1).catch(() => undefined)
    onClose()
  }
  const total = fileHits.hits.length + response.results.length
  const activateIndex = (i: number) => {
    if (i < fileHits.hits.length) openHit(fileHits.hits[i])
    else if (response.results[i - fileHits.hits.length]) activate(response.results[i - fileHits.hits.length])
  }
  const activate = (r: SearchResult) => {
    if (r.id.startsWith('manual-task:')) {
      setCurrentProject(r.projectId)
      paneActions.open(null)
      requestTask(r.projectId, r.itemId!)
      onClose()
      return
    }
    window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId: r.sessionId, itemId: r.itemId } }))
    onClose()
  }
  useEffect(() => {
    inputRef.current?.focus()
  }, [inputRef])
  useEffect(() => {
    const requestId = ++requestSequence
    request.current = requestId
    setLoading(true)
    setError(null)
    setResponse(emptyResponse)
    setFileHits(noFiles)
    setSelected(0)
    if (composing) return
    let disposed = false
    const timer = window.setTimeout(
      async () => {
        // 项目文件：「全部」里带前几条，「项目文件」范围取全部；需要有项目和搜索词
        const wantFiles = (scope === 'all' || scope === 'files') && !!text.trim() && !!fileRef
        const files = wantFiles
          ? isDemo
            ? Promise.resolve(
                demoFileHits(fileRef!, demo().files.contents, text.trim(), scope === 'files' ? 'full' : 'brief'),
              )
            : searchFiles(fileRef!, text, scope === 'files' ? 'full' : 'brief').catch(err =>
                // 「全部」里文件搜索出错不影响会话结果；「项目文件」范围直接显示错误
                scope === 'files' ? Promise.reject(err) : noFiles,
              )
          : Promise.resolve(noFiles)
        if (scope === 'files') {
          try {
            const hits = await files
            if (!disposed && request.current === requestId) setFileHits(hits)
          } catch (err) {
            if (!disposed && request.current === requestId) setError((err as Error).message)
          } finally {
            if (!disposed && request.current === requestId) setLoading(false)
          }
          return
        }
        const query: SearchQuery = { requestId, text, scope, projectId }
        try {
          const [result, tasks, hits] = await Promise.all([
            isDemo ? demo().search.run(query) : bridge?.search(query),
            !isDemo && scope === 'all' && text.trim()
              ? window.pixelsky?.projectTools.searchTasks(text, projectId)
              : Promise.resolve([]),
            files,
          ])
          if (result && tasks?.length) {
            const rows: SearchResult[] = tasks.map(task => ({
              id: 'manual-task:' + task.id,
              sessionId: '',
              itemId: task.id,
              kind: 'todo',
              field: tr('projectTools.myTasks'),
              title: task.title,
              projectId: task.projectId,
              projectName: projects.find(p => p.id === task.projectId)?.name ?? '',
              engine: 'claude',
              updatedAt: task.updatedAt,
              snippet: searchSnippet(task.title + '\n' + task.note, searchTerms(text)),
              rank: 0,
            }))
            result.results = [...rows, ...result.results].slice(0, 50)
          }
          if (disposed || request.current !== requestId || result?.cancelled) return
          if (!result) throw new Error(tr('search.SearchDialog.localConversationSearchIs'))
          setResponse(result)
          setFileHits(hits)
        } catch (err) {
          if (!disposed && request.current === requestId) setError((err as Error).message)
        } finally {
          if (!disposed && request.current === requestId) setLoading(false)
        }
      },
      text.trim() ? 180 : 0,
    )
    return () => {
      disposed = true
      window.clearTimeout(timer)
      if (!isDemo) void bridge?.cancelSearch(requestId).catch(() => undefined)
    }
  }, [text, scope, projectId, composing, fileRefKey])
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>(`[data-result-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected, response, fileHits])

  return (
    <div
      className="fade-in no-drag fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[min(10vh,80px)]"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        data-global-search
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-title"
        className="pop-in flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-line-card bg-popover shadow-menu"
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || composing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && total) {
            e.preventDefault()
            setSelected(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + total) % total)
          } else if (e.key === 'Enter' && e.target === inputRef.current && selected < total && !loading) {
            e.preventDefault()
            activateIndex(selected)
          } else if (e.key === 'Tab') {
            const focusable = Array.from(
              dialog.current?.querySelectorAll<HTMLElement>('input,select,button:not(:disabled),[tabindex="0"]') ?? [],
            ).filter(el => el.getBoundingClientRect().width > 0)
            const first = focusable[0],
              last = focusable.at(-1)
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last?.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header className="flex items-center gap-3 px-4 pt-3 pb-1.5">
          <h2 id="search-title" className="flex-1 text-ui font-medium text-fg-secondary">
            {tr('search.SearchDialog.searchConversationsAndContent')}
          </h2>
          <IconButton
            icon={X}
            label={tr('search.SearchDialog.closeSearchEsc')}
            size={24}
            iconSize={14}
            onClick={onClose}
          />
        </header>
        <div className="mx-4 flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 focus-within:border-accent-line">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="search"
            value={text}
            maxLength={200}
            placeholder={tr('search.SearchDialog.searchTitlesMessagesCommands')}
            aria-label={tr('search.SearchDialog.searchTerms')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded
            aria-controls="global-search-results"
            aria-activedescendant={selected < total ? `search-result-${selected}` : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-prose text-fg outline-none placeholder:text-fg-faint"
            onChange={e => setText(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={e => {
              setText(e.currentTarget.value)
              setComposing(false)
            }}
          />
          {loading && <Spinner size={14} />}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-3">
          <div role="group" aria-label={tr('search.SearchDialog.searchScope')} className="flex flex-wrap gap-1">
            {SCOPES.map(s => (
              <button
                key={s.id}
                type="button"
                aria-pressed={scope === s.id}
                onClick={() => setScope(s.id)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-meta',
                  scope === s.id ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="min-w-2 flex-1" />
          <ProjectFilter projects={options} value={projectId} onChange={setProjectId} />
        </div>
        <div
          className="min-h-36 min-w-0 flex-1 overflow-y-auto p-2"
          id="global-search-results"
          role="listbox"
          aria-label={tr('search.SearchDialog.searchResults')}
          aria-busy={loading}
        >
          {fileHits.hits.map((hit, i) => (
            <button
              key={hit.key}
              id={`search-result-${i}`}
              type="button"
              role="option"
              aria-selected={i === selected}
              tabIndex={-1}
              data-result-index={i}
              data-file-hit={hit.key}
              onMouseEnter={() => setSelected(i)}
              onClick={() => openHit(hit)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left',
                i === selected ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <FileText size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-fg">{hit.path.split('/').pop()}</span>
                <span className="mt-0.5 block truncate text-label text-fg-faint">
                  {hit.path} ·{' '}
                  {hit.line === null
                    ? tr('search.SearchDialog.fileName')
                    : tr('search.SearchDialog.fileLine', { line: hit.line })}
                </span>
                {hit.text && (
                  <span className="mt-1 block truncate font-mono text-meta text-fg-muted">
                    <Fragments parts={searchSnippet(hit.text.trim(), searchTerms(text))} />
                  </span>
                )}
              </span>
              {i === selected && <CornerDownLeft size={13} className="mt-1 shrink-0 text-fg-faint" />}
            </button>
          ))}
          {response.results.map((r, n) => {
            const i = n + fileHits.hits.length
            const Icon = r.itemId
              ? ['command', 'tool', 'file_change'].includes(r.kind)
                ? SquareTerminal
                : MessageSquare
              : r.kind === 'project'
                ? Folder
                : MessageSquare
            return (
              <button
                key={r.id}
                id={`search-result-${i}`}
                type="button"
                role="option"
                aria-selected={i === selected}
                tabIndex={-1}
                data-result-index={i}
                onMouseEnter={() => setSelected(i)}
                onClick={() => activate(r)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left',
                  i === selected ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium text-fg">{r.title}</span>
                  <span className="mt-0.5 block truncate text-label text-fg-faint">
                    {r.projectName} ·{' '}
                    {r.id.startsWith('manual-task:') ? tr('projectTools.myTasks') : ENGINES[r.engine].name} ·{' '}
                    {new Date(r.updatedAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {r.field}
                  </span>
                  {text.trim() && (
                    <span className="mt-1 block whitespace-pre-wrap break-words text-meta leading-relaxed text-fg-muted">
                      <Fragments parts={r.snippet} />
                    </span>
                  )}
                </span>
                {i === selected && <CornerDownLeft size={13} className="mt-1 shrink-0 text-fg-faint" />}
              </button>
            )
          })}
          {!total && (
            <div role="status" className="px-4 py-9 text-center text-ui text-fg-muted">
              {loading
                ? tr('search.SearchDialog.searching')
                : error
                  ? translateMessage(error)
                  : scope === 'files'
                    ? !fileRef
                      ? tr('search.SearchDialog.openAProjectFirst')
                      : text.trim()
                        ? tr('search.SearchDialog.noMatchingContentTry')
                        : tr('search.SearchDialog.typeToSearchFiles')
                    : !response.sessionCount
                      ? tr('search.SearchDialog.noConversationsYetStart')
                      : text.trim()
                        ? tr('search.SearchDialog.noMatchingContentTry')
                        : tr('search.SearchDialog.noConversationsInThis')}
            </div>
          )}
          {scope === 'files' && fileHits.truncated && (
            <p role="status" className="px-3 py-2 text-meta text-fg-muted">
              {tr('search.SearchDialog.fileResultsPartial')}
            </p>
          )}
          {response.partial && (
            <p role="status" className="px-3 py-2 text-meta text-warn">
              {tr('search.SearchDialog.someConversationRecordsCould')}
            </p>
          )}
          {response.truncated && (
            <p role="status" className="px-3 py-2 text-meta text-fg-muted">
              {tr('search.SearchDialog.tooManyResultsNarrow')}
            </p>
          )}
        </div>
        <footer className="flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 text-label text-fg-faint">
          <span className="flex-1">
            {text.trim() ? tr('search.SearchDialog.localSearch') : tr('search.SearchDialog.recentConversations')}
          </span>
          <span>{tr('search.SearchDialog.select')}</span>
          <span>{tr('search.SearchDialog.enterOpen')}</span>
          <span>{tr('search.SearchDialog.escClose')}</span>
        </footer>
      </div>
    </div>
  )
}
