import { useEffect, useRef, useState } from 'react'
import { Folder, FolderInput, FolderPlus, RefreshCw, X } from 'lucide-react'
import type {
  ProjectImportBatch,
  ProjectImportCandidate,
  ProjectImportTool,
} from '../../../../shared/types/project-import'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '@/i18n/core'
import { Button, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import {
  BULK_IMPORT_PROJECTS_EVENT,
  addProjectPaths,
  pickProjectImports,
  previewProjectPaths,
  scanProjectImports,
} from '@/features/engine/store'
import { GROUP_NAME_LIMIT, getSidebarPrefs, setProjectGroups } from '@/features/appearance/sidebar'
import { addToGroup, createGroup, newGroupId, renameGroup } from './projectGroups'
import { addedSummary, mergeImportCandidates } from './projectImportModel'

const TOOLS: Array<{ id: ProjectImportTool; name: string }> = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'zcode', name: 'Z Code' },
  { id: 'kimi', name: 'Kimi Code' },
]
const selectable = (c: ProjectImportCandidate): boolean => !c.added && !c.issue

export function BulkProjectImport() {
  useI18n()
  const [opened, setOpened] = useState(false)
  const [candidates, setCandidates] = useState<ProjectImportCandidate[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failures, setFailures] = useState<Array<{ path: string; error: string }>>([])
  const [tool, setTool] = useState<ProjectImportTool>('zcode')
  const [paths, setPaths] = useState('')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(200)
  const [grouped, setGrouped] = useState(false)
  const [groupName, setGroupName] = useState('')
  const importedGroup = useRef<string | null>(null)

  useEffect(() => {
    const open = (): void => {
      setOpened(true)
      setCandidates([])
      setPicked(new Set())
      setWarnings([])
      setError(null)
      setNotice(null)
      setFailures([])
      setPaths('')
      setQuery('')
      setVisibleCount(200)
      setGrouped(false)
      setGroupName('')
      importedGroup.current = null
    }
    window.addEventListener(BULK_IMPORT_PROJECTS_EVENT, open)
    return () => window.removeEventListener(BULK_IMPORT_PROJECTS_EVENT, open)
  }, [])

  if (!opened) return null
  const load = async (fn: () => Promise<ProjectImportBatch | null>): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await fn()
      if (!next) return
      setWarnings(previous => [...new Set([...previous, ...next.warnings])])
      if (!next.candidates.length) setNotice(tr('projectImport.noDetected'))
      const known = new Set(candidates.map(c => c.path))
      setCandidates(previous => mergeImportCandidates(previous, next.candidates))
      setPicked(previous => {
        const selected = new Set(previous)
        for (const c of next.candidates) {
          if (!selectable(c)) selected.delete(c.path)
          else if (!known.has(c.path) && c.project) selected.add(c.path)
        }
        return selected
      })
    } catch (e) {
      setError(translateMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }
  const shown = candidates.filter(c =>
    `${c.name}\n${c.path}\n${c.sources.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  )
  const choices = shown.filter(selectable)
  const allPicked = choices.length > 0 && choices.every(c => picked.has(c.path))
  const selected = candidates.filter(c => selectable(c) && picked.has(c.path))
  const toggle = (path: string): void =>
    setPicked(previous => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await addProjectPaths(selected.map(c => c.path))
      if (!result) return
      const name = Array.from(groupName.trim()).slice(0, GROUP_NAME_LIMIT).join('')
      const ids = [...result.added, ...result.existing].map(p => p.id)
      if (grouped && name && ids.length && (selected.length > 1 || importedGroup.current)) {
        const groups = getSidebarPrefs().groups ?? []
        const id = importedGroup.current ?? newGroupId()
        setProjectGroups(
          groups.some(g => g.id === id)
            ? renameGroup(addToGroup(groups, id, ids), id, name)
            : createGroup(groups, { id, name }, ids),
        )
        importedGroup.current = id
      }
      if (!result.failed.length) {
        setOpened(false)
        return
      }
      const added = new Set([...result.added, ...result.existing].map(p => p.path))
      setCandidates(previous => previous.map(c => (added.has(c.path) ? { ...c, added: true } : c)))
      setPicked(new Set(result.failed.map(c => c.path)))
      setFailures(result.failed)
      setError(tr('projectImport.retryFailed', { n: result.failed.length }))
      setNotice(addedSummary(result))
    } catch (e) {
      setError(translateMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <ConfirmDialog
      title={tr('projectImport.bulkTitle')}
      busy={busy}
      error={error}
      confirmDisabled={
        !selected.length || ((selected.length > 1 || !!importedGroup.current) && grouped && !groupName.trim())
      }
      confirmLabel={tr(busy ? 'projectImport.working' : 'projectImport.confirm', { n: selected.length })}
      cancelLabel={tr('projectImport.cancel')}
      onConfirm={() => void confirm()}
      onCancel={() => setOpened(false)}
      description={
        <div data-bulk-project-import className="max-h-[calc(100vh-12rem)] overflow-y-auto pr-1">
          <p className="text-meta text-fg-muted">{tr('projectImport.bulkIntro')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} icon={FolderPlus} onClick={() => void load(() => pickProjectImports('folders'))}>
              {tr('projectImport.chooseMore')}
            </Button>
            <Button disabled={busy} icon={FolderInput} onClick={() => void load(() => pickProjectImports('parent'))}>
              {tr('projectImport.scanParents')}
            </Button>
            <Button disabled={busy} icon={RefreshCw} onClick={() => void load(scanProjectImports)}>
              {tr('projectImport.scanTools')}
            </Button>
          </div>
          <p className="mt-2 text-meta text-fg-faint">Claude Code · Codex · Z Code · Kimi Code</p>
          <div className="mt-2 flex items-center gap-2">
            <select
              aria-label={tr('projectImport.sourceTool')}
              value={tool}
              disabled={busy}
              onChange={e => setTool(e.target.value as ProjectImportTool)}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-ui text-fg"
            >
              {TOOLS.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button disabled={busy} onClick={() => void load(() => pickProjectImports(tool))}>
              {tr('projectImport.chooseList')}
            </Button>
          </div>
          <details className="mt-3 text-meta">
            <summary className="cursor-pointer text-fg-secondary">{tr('projectImport.pathList')}</summary>
            <textarea
              aria-label={tr('projectImport.pathList')}
              value={paths}
              disabled={busy}
              rows={3}
              onChange={e => setPaths(e.target.value)}
              placeholder={tr('projectImport.pathHint')}
              className="mt-2 w-full resize-y rounded-md border border-line bg-surface p-2 text-meta text-fg outline-none focus:border-accent-line"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy || !paths.trim()} onClick={() => void load(() => previewProjectPaths(paths))}>
                {tr('projectImport.previewPaths')}
              </Button>
              <Button disabled={busy} onClick={() => void load(() => pickProjectImports('paths'))}>
                {tr('projectImport.choosePathFile')}
              </Button>
            </div>
          </details>
          {notice && (
            <p role="status" className="mt-2 text-meta text-fg-muted">
              {notice}
            </p>
          )}
          {!!failures.length && (
            <details open className="mt-2 text-meta text-danger">
              <summary>{tr('projectImport.failureDetails')}</summary>
              <ul className="max-h-24 overflow-auto">
                {failures.map(f => (
                  <li key={f.path} className="break-all">
                    {f.path}：{translateMessage(f.error)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!warnings.length && (
            <ul className="mt-2 text-meta text-warn">
              {warnings.map(w => (
                <li key={w}>{translateMessage(w)}</li>
              ))}
            </ul>
          )}
          {!!candidates.length && (
            <>
              <input
                aria-label={tr('projectImport.search')}
                value={query}
                disabled={busy}
                onChange={e => {
                  setQuery(e.target.value)
                  setVisibleCount(200)
                }}
                placeholder={tr('projectImport.search')}
                className="mt-3 h-8 w-full rounded-md border border-line bg-surface px-2 text-ui text-fg outline-none focus:border-accent-line"
              />
              <label className="mt-2 flex items-center gap-2 text-meta text-fg-muted">
                <input
                  type="checkbox"
                  checked={allPicked}
                  disabled={busy || !choices.length}
                  onChange={() =>
                    setPicked(previous => {
                      const next = new Set(previous)
                      for (const c of choices) {
                        if (allPicked) next.delete(c.path)
                        else next.add(c.path)
                      }
                      return next
                    })
                  }
                />
                {tr('projectImport.selectAllShown', { n: selected.length, total: candidates.length })}
              </label>
              <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-line p-1">
                {shown.slice(0, visibleCount).map(c => (
                  <li key={c.path} className="flex items-center gap-1">
                    <label
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5',
                        selectable(c) ? 'cursor-pointer hover:bg-hover' : 'text-fg-faint',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={c.added || picked.has(c.path)}
                        disabled={busy || !selectable(c)}
                        onChange={() => toggle(c.path)}
                      />
                      <Folder size={14} className="shrink-0" />
                      <span className="min-w-0 flex-1" title={c.path}>
                        <span className="block truncate text-ui">{c.name}</span>
                        <span className="block truncate text-label text-fg-faint">{c.path}</span>
                        <span className="block truncate text-label text-fg-muted">
                          {c.sources
                            .map(s =>
                              s === 'Folders'
                                ? tr('projectImport.foldersSource')
                                : s === 'Paths'
                                  ? tr('projectImport.pathsSource')
                                  : s,
                            )
                            .join(' · ')}
                        </span>
                      </span>
                      {(c.added || c.issue) && (
                        <span className="shrink-0 text-label">
                          {tr(c.issue ? `projectImport.issue.${c.issue}` : 'projectImport.alreadyAdded')}
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={tr('projectImport.removeCandidate', { name: c.name })}
                      className="rounded p-1 text-fg-faint hover:bg-hover hover:text-fg"
                      onClick={() => {
                        setCandidates(previous => previous.filter(item => item.path !== c.path))
                        setPicked(previous => {
                          const next = new Set(previous)
                          next.delete(c.path)
                          return next
                        })
                      }}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              {shown.length > visibleCount && (
                <Button disabled={busy} onClick={() => setVisibleCount(count => count + 200)}>
                  {tr('projectImport.showMore', { n: Math.min(visibleCount, shown.length), total: shown.length })}
                </Button>
              )}
              {(selected.length > 1 || !!importedGroup.current) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-meta">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={grouped}
                      disabled={busy}
                      onChange={e => setGrouped(e.target.checked)}
                    />
                    {tr('projectImport.group')}
                  </label>
                  {grouped && (
                    <input
                      aria-label={tr('projectImport.groupName')}
                      disabled={busy}
                      value={groupName}
                      maxLength={GROUP_NAME_LIMIT * 2}
                      onChange={e => setGroupName(e.target.value)}
                      className="h-7 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-fg"
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      }
    />
  )
}
