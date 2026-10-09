import { searchSnippet, searchTerms } from '@pixelsky/protocol'
import { setCurrentProject } from '@/engine/store'
import { paneActions } from '@/panes/store'
import { requestTask } from '@/components/panel/taskNavigation'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../i18n/core'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { CornerDownLeft, Folder, MessageSquare, Search, SquareTerminal, X } from 'lucide-react'
import type { SearchQuery, SearchResponse, SearchResult, SearchScope } from '@pixelsky/protocol'
import { IconButton, Spinner, cn } from '@/components/ui'
import { OPEN_SESSION_EVENT, bridge, useEngineState } from '@/engine'
import { isDemo } from '@/mock/data'
import { demoSearchProjects, searchDemo } from '@/mock/search'
import { ProjectFilter } from './ProjectFilter'

const SCOPES: Array<{ id: SearchScope; name: string }> = [{ id: 'all', get name() { return tr("search.SearchDialog.message588") } }, { id: 'titles', get name() { return tr("search.SearchDialog.message589") } }, { id: 'messages', get name() { return tr("search.SearchDialog.message590") } }, { id: 'tools', get name() { return tr("search.SearchDialog.message591") } }]
let requestSequence = 0
const emptyResponse: SearchResponse = { requestId: 0, results: [], truncated: false, partial: false, sessionCount: 0 }

function Fragments({ parts }: { parts: SearchResult['snippet'] }) {
  useI18n()
  return <>{parts.map((p, i) => p.match ? <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent-fg">{p.text}</mark> : <span key={i}>{p.text}</span>)}</>
}

export function SearchDialog({ inputRef, onClose }: { inputRef: RefObject<HTMLInputElement | null>; onClose: () => void }) {
  useI18n()
  const [text, setText] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [response, setResponse] = useState(emptyResponse)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [composing, setComposing] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const projects = useEngineState(s => s.projects)
  const options = isDemo ? demoSearchProjects : projects
  const activate = (r: SearchResult) => {
    if (r.id.startsWith('manual-task:')) {
      setCurrentProject(r.projectId); paneActions.open(null)
      requestTask(r.projectId, r.itemId!)
      onClose(); return
    }
    window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId: r.sessionId, itemId: r.itemId } }))
    onClose()
  }
  useEffect(() => { inputRef.current?.focus() }, [inputRef])
  useEffect(() => {
    const requestId = ++requestSequence
    request.current = requestId
    setLoading(true); setError(null); setResponse(emptyResponse); setSelected(0)
    if (composing) return
    let disposed = false
    const timer = window.setTimeout(async () => {
      const query: SearchQuery = { requestId, text, scope, projectId }
      try {
        const [result, tasks] = await Promise.all([
          isDemo ? searchDemo(query) : bridge?.search(query),
          !isDemo && scope === 'all' && text.trim() ? window.pixelsky?.projectTools.searchTasks(text, projectId) : Promise.resolve([]),
        ])
        if (result && tasks?.length) {
          const rows: SearchResult[] = tasks.map(task => ({
            id: 'manual-task:' + task.id, sessionId: '', itemId: task.id, kind: 'todo', field: tr('projectTools.myTasks'),
            title: task.title, projectId: task.projectId, projectName: projects.find(p => p.id === task.projectId)?.name ?? '',
            engine: 'claude', updatedAt: task.updatedAt, snippet: searchSnippet(task.title + '\n' + task.note, searchTerms(text)), rank: 0,
          }))
          result.results = [...rows, ...result.results].slice(0, 50)
        }
        if (disposed || request.current !== requestId || result?.cancelled) return
        if (!result) throw new Error(tr("search.SearchDialog.message592"))
        setResponse(result)
      } catch (err) { if (!disposed && request.current === requestId) setError((err as Error).message) }
      finally { if (!disposed && request.current === requestId) setLoading(false) }
    }, text.trim() ? 180 : 0)
    return () => { disposed = true; window.clearTimeout(timer); if (!isDemo) void bridge?.cancelSearch(requestId).catch(() => undefined) }
  }, [text, scope, projectId, composing])
  useEffect(() => { dialog.current?.querySelector<HTMLElement>(`[data-result-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' }) }, [selected, response])

  return (
    <div className="fade-in no-drag fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[min(10vh,80px)]" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialog} data-global-search role="dialog" aria-modal="true" aria-labelledby="search-title" className="pop-in flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-line-card bg-popover shadow-menu"
        onKeyDown={e => {
          if (e.nativeEvent.isComposing || composing) return
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
          else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && response.results.length) {
            e.preventDefault(); setSelected(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + response.results.length) % response.results.length)
          } else if (e.key === 'Enter' && e.target === inputRef.current && response.results[selected] && !loading) { e.preventDefault(); activate(response.results[selected]) }
          else if (e.key === 'Tab') {
            const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input,select,button:not(:disabled),[tabindex="0"]') ?? []).filter(el => el.getBoundingClientRect().width > 0)
            const first = focusable[0], last = focusable.at(-1)
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
          }
        }}>
        <header className="flex items-center gap-3 px-4 pt-3 pb-1.5">
          <h2 id="search-title" className="flex-1 text-ui font-medium text-fg-secondary">{tr("search.SearchDialog.message593")}</h2>
          <IconButton icon={X} label={tr("search.SearchDialog.message594")} size={24} iconSize={14} onClick={onClose} />
        </header>
        <div className="mx-4 flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 focus-within:border-accent-line">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" />
          <input ref={inputRef} type="search" value={text} maxLength={200} placeholder={tr("search.SearchDialog.message595")} aria-label={tr("search.SearchDialog.message596")} role="combobox" aria-autocomplete="list" aria-expanded aria-controls="global-search-results" aria-activedescendant={response.results[selected] ? `search-result-${selected}` : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-prose text-fg outline-none placeholder:text-fg-faint" onChange={e => setText(e.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={e => { setText(e.currentTarget.value); setComposing(false) }} />
          {loading && <Spinner size={14} />}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-3">
          <div role="group" aria-label={tr("search.SearchDialog.message597")} className="flex flex-wrap gap-1">
            {SCOPES.map(s => <button key={s.id} type="button" aria-pressed={scope === s.id} onClick={() => setScope(s.id)} className={cn('rounded-md px-2 py-1.5 text-meta', scope === s.id ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-hover hover:text-fg')}>{s.name}</button>)}
          </div>
          <div className="min-w-2 flex-1" />
          <ProjectFilter projects={options} value={projectId} onChange={setProjectId} />
        </div>
        <div className="min-h-36 min-w-0 flex-1 overflow-y-auto p-2" id="global-search-results" role="listbox" aria-label={tr("search.SearchDialog.message598")} aria-busy={loading}>
          {response.results.map((r, i) => {
            const Icon = r.itemId ? ['command', 'tool', 'file_change'].includes(r.kind) ? SquareTerminal : MessageSquare : r.kind === 'project' ? Folder : MessageSquare
            return <button key={r.id} id={`search-result-${i}`} type="button" role="option" aria-selected={i === selected} tabIndex={-1} data-result-index={i} onMouseEnter={() => setSelected(i)} onClick={() => activate(r)} className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left', i === selected ? 'bg-selected' : 'hover:bg-hover')}>
              <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium text-fg">{r.title}</span>
                <span className="mt-0.5 block truncate text-label text-fg-faint">{r.projectName} · {r.id.startsWith('manual-task:') ? tr('projectTools.myTasks') : r.engine === 'claude' ? 'Claude Code' : 'Codex'} · {new Date(r.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {r.field}</span>
                {text.trim() && <span className="mt-1 block whitespace-pre-wrap break-words text-meta leading-relaxed text-fg-muted"><Fragments parts={r.snippet} /></span>}
              </span>
              {i === selected && <CornerDownLeft size={13} className="mt-1 shrink-0 text-fg-faint" />}
            </button>
          })}
          {!response.results.length && <div role="status" className="px-4 py-9 text-center text-ui text-fg-muted">{loading ? tr("search.SearchDialog.message599") : error ?? (!response.sessionCount ? tr("search.SearchDialog.message600") : text.trim() ? tr("search.SearchDialog.message601") : tr("search.SearchDialog.message602"))}</div>}
          {response.partial && <p role="status" className="px-3 py-2 text-meta text-warn">{tr("search.SearchDialog.message603")}</p>}
          {response.truncated && <p role="status" className="px-3 py-2 text-meta text-fg-muted">{tr("search.SearchDialog.message604")}</p>}
        </div>
        <footer className="flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 text-label text-fg-faint"><span className="flex-1">{text.trim() ? tr("search.SearchDialog.message605") : tr("search.SearchDialog.message606")}</span><span>{tr("search.SearchDialog.message607")}</span><span>{tr("search.SearchDialog.message608")}</span><span>{tr("search.SearchDialog.message609")}</span></footer>
      </div>
    </div>
  )
}
