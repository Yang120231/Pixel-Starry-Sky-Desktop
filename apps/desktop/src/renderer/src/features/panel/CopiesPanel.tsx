import { isChatProject } from '@pixelsky/protocol'
import { useEffect, useState } from 'react'
import { Copy, FolderOpen, MessageSquare } from 'lucide-react'
import { Button, IconButton, Select } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { OPEN_SESSION_EVENT } from '@/features/engine/openRequests'
import { getFiles, dirtyFile, showFiles } from '@/features/files/store'
import { useProjectContext } from './projectContext'
import { CARD, FIELD, Field, NoProject, ToolError, ToolsHeader, useOperation } from './ToolsUi'
import type { CopyInput, CopyPreview, ProjectCopy } from '../../../../shared/types/project-tools'
import { demo as demoData } from '@/data/demo'
const blank: CopyInput = { name: '', branch: '', base: 'HEAD', existingBranch: false }
export function CopiesPanel() {
  const ctx = useProjectContext()
  return ctx.projectId && !isChatProject(ctx.projectId) ? (
    <CopiesBody key={ctx.projectId} projectId={ctx.projectId} name={ctx.name} demo={ctx.demo} />
  ) : (
    <NoProject chat={isChatProject(ctx.projectId)} />
  )
}
function CopiesBody({ projectId, name, demo }: { projectId: string; name: string; demo: boolean }) {
  useI18n()
  const [copies, setCopies] = useState<ProjectCopy[]>(demo ? structuredClone(demoData().projectTools.copies) : []),
    [branches, setBranches] = useState<string[]>([])
  const [form, setForm] = useState<CopyInput | null>(null),
    [preview, setPreview] = useState<CopyPreview | null>(null)
  const [removing, setRemoving] = useState<{
    copy: ProjectCopy
    forget: boolean
    force: boolean
    leftover?: boolean
  } | null>(null)
  const { busy, error, setError, run } = useOperation()
  const load = async () => {
    if (!demo) setCopies(await window.pixelsky!.projectTools.copies(projectId))
  }
  useEffect(() => {
    if (demo) {
      setBranches(['main'])
      return
    }
    let gone = false
    // 每个副本要跑几条 git：同一时间只取一次，取的时候又变了就等这次完了再取一次
    let running: Promise<void> | null = null,
      again = false
    const refresh = (): Promise<void> => {
      if (running) {
        again = true
        return running
      }
      running = window
        .pixelsky!.projectTools.copies(projectId)
        .then(next => {
          if (!gone) setCopies(next)
        })
        .catch(e => {
          if (!gone) setError(e.message)
        })
        .finally(() => {
          running = null
          if (again && !gone) {
            again = false
            void refresh()
          }
        })
      return running
    }
    void refresh()
    void window
      .pixelsky!.projectTools.branches(projectId)
      .then(next => {
        if (!gone) setBranches(next)
      })
      .catch(() => {})
    // 只是服务多了几行输出时不重取（docs/perf-audit-2026-10-18.md B2）
    const off = window.pixelsky!.projectTools.onChange(kind => kind === 'state' && void refresh())
    return () => {
      gone = true
      off()
    }
  }, [])
  const open = (copy: ProjectCopy, files = false, fresh = false) =>
    run(async () => {
      if (demo) return
      const existing = fresh ? undefined : copy.sessions[0]
      const id = existing?.id ?? (await window.pixelsky!.projectTools.openCopy(copy.id)).id
      window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId: id } }))
      if (files) showFiles({ sessionId: id })
    })
  const create = () =>
    run(async () => {
      if (!preview) return
      if (demo)
        setCopies(items => [
          ...items,
          {
            ...demoData().projectTools.copies[0],
            id: crypto.randomUUID(),
            name: preview.input.name,
            branch: preview.branch,
            path: preview.path,
          },
        ])
      else {
        await window.pixelsky!.projectTools.createCopy(projectId, preview.input)
        await load()
      }
      setPreview(null)
      setForm(null)
    })
  const remove = () =>
    run(async () => {
      if (!removing) return
      const { copy, forget, force } = removing
      if (
        !forget &&
        getFiles().tabs.some(
          f =>
            dirtyFile(f) &&
            f.root
              .replaceAll('\\', '/')
              .toLowerCase()
              .startsWith(copy.path.replaceAll('\\', '/').toLowerCase() + '/'),
        )
      )
        throw new Error(tr('projectTools.saveCopyFiles'))
      if (
        !forget &&
        getFiles().tabs.some(
          f =>
            dirtyFile(f) &&
            f.root.replaceAll('\\', '/').toLowerCase() === copy.path.replaceAll('\\', '/').toLowerCase(),
        )
      )
        throw new Error(tr('projectTools.saveCopyFiles'))
      if (demo) setCopies(items => items.filter(c => c.id !== copy.id))
      else {
        try {
          if (forget) await window.pixelsky!.projectTools.forgetCopy(copy.id)
          else await window.pixelsky!.projectTools.removeCopy(copy.id, force)
        } catch (e) {
          if ((e as Error).message.includes('未提交'))
            setRemoving({ copy: { ...copy, dirty: true }, forget: false, force: false })
          else if ((e as Error).message.includes('残留目录不是空的'))
            setRemoving({ copy, forget: false, force: false, leftover: true })
          throw e
        }
        await load()
      }
      setRemoving(null)
    })
  return (
    <div data-tools-copies className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      <ToolsHeader title={tr('projectTools.copiesTitle')} subtitle={name} busy={busy} refresh={() => void run(load)} />
      <ToolError error={error} />
      <Button
        onClick={() => {
          setForm({ ...blank })
          setPreview(null)
        }}
      >
        {tr('projectTools.newCopy')}
      </Button>
      {form && (
        <form
          onSubmit={e => {
            e.preventDefault()
            void run(async () => {
              const input = { ...form, branch: form.branch || 'pixelsky/' + form.name }
              setPreview(
                demo
                  ? {
                      input,
                      path: 'D:/copies/' + input.name,
                      commit: 'a1b2c3d',
                      branch: input.branch,
                      root: 'D:/pixel-web',
                    }
                  : await window.pixelsky!.projectTools.previewCopy(projectId, input),
              )
            })
          }}
          className={CARD + ' flex flex-col gap-2'}
        >
          <Field label={tr('projectTools.copyName')}>
            <input
              required
              autoFocus
              maxLength={80}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className={FIELD}
            />
          </Field>
          <Select
            label={tr('projectTools.branch')}
            value={form.existingBranch ? 'existing' : 'new'}
            options={[
              { value: 'new', label: tr('projectTools.newBranch') },
              { value: 'existing', label: tr('projectTools.existingBranch') },
            ]}
            onChange={v => setForm({ ...form, existingBranch: v === 'existing', branch: '' })}
          />
          {form.existingBranch ? (
            <Select
              label={tr('projectTools.chooseBranch')}
              value={form.branch}
              options={[
                { value: '', label: tr('projectTools.chooseBranch') },
                ...branches.map(b => ({ value: b, label: b })),
              ]}
              onChange={branch => setForm({ ...form, branch })}
            />
          ) : (
            <Field label={tr('projectTools.branchName')}>
              <input
                value={form.branch}
                onChange={e => setForm({ ...form, branch: e.target.value })}
                placeholder={'pixelsky/' + form.name}
                className={FIELD}
              />
            </Field>
          )}
          <Field label={tr('projectTools.baseBranch')}>
            <Select
              label={tr('projectTools.baseBranch')}
              value={form.base}
              options={[{ value: 'HEAD', label: 'HEAD' }, ...branches.map(b => ({ value: b, label: b }))]}
              onChange={base => setForm({ ...form, base })}
            />
          </Field>
          <Field label={tr('projectTools.copyDirectory')}>
            <input
              value={form.directory ?? ''}
              onChange={e => setForm({ ...form, directory: e.target.value })}
              placeholder={tr('projectTools.defaultCopyDirectory')}
              className={FIELD}
            />
          </Field>
          <Button
            disabled={busy || demo || !form.name.trim()}
            onClick={() =>
              void run(async () => {
                const parent = await window.pixelsky!.projectTools.chooseDirectory()
                if (parent) setForm({ ...form, directory: parent.replace(/[\\/]$/, '') + '/' + form.name })
              })
            }
          >
            {tr('projectTools.chooseCopyParent')}
          </Button>
          <p className="text-meta text-fg-muted">{tr('projectTools.copyCommitHint')}</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !form.name.trim()} variant="primary">
              {tr('projectTools.previewCreate')}
            </Button>
            <Button onClick={() => setForm(null)}>{tr('projectTools.cancel')}</Button>
          </div>
        </form>
      )}
      {!copies.length && <p className="py-6 text-center text-list text-fg-muted">{tr('projectTools.noCopiesHint')}</p>}
      {copies.map(copy => (
        <article key={copy.id} data-tool-copy={copy.id} className={CARD}>
          <div className="flex items-center gap-2">
            <Copy size={16} className="text-fg-muted" />
            <h3 className="min-w-0 flex-1 break-words text-list font-medium text-fg">{copy.name}</h3>
            <span className={'text-meta ' + (copy.dirty ? 'text-warn' : 'text-success')}>
              {copy.dirty ? tr('projectTools.copyDirty') : tr('projectTools.copyClean')}
            </span>
          </div>
          <p className="mt-2 break-all font-mono text-meta text-fg-secondary">
            {copy.branch} · {copy.baseCommit.slice(0, 8)}
          </p>
          <p className="mt-1 break-all text-meta text-fg-muted">{copy.path}</p>
          <p className="mt-1 text-meta text-fg-faint">
            {tr('projectTools.copyCounts', { p0: copy.ahead, p1: copy.behind, p2: copy.changedCount })}
          </p>
          {copy.error && <ToolError error={copy.error} />}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button icon={MessageSquare} disabled={busy || !!copy.error} onClick={() => void open(copy)}>
              {tr('projectTools.openCopyChat')}
            </Button>
            <Button disabled={busy || !!copy.error} onClick={() => void open(copy, false, true)}>
              {tr('projectTools.newCopyChat')}
            </Button>
            <IconButton
              icon={FolderOpen}
              label={tr('projectTools.openFolder')}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!demo) await window.pixelsky!.projectTools.revealCopy(copy.id)
                })
              }
            />
            <Button disabled={busy || !!copy.error} onClick={() => void open(copy, true)}>
              {tr('projectTools.openCopyFiles')}
            </Button>
            <Button disabled={busy} variant="ghost" onClick={() => setRemoving({ copy, forget: false, force: false })}>
              {tr('projectTools.remove')}
            </Button>
            <Button disabled={busy} variant="ghost" onClick={() => setRemoving({ copy, forget: true, force: false })}>
              {tr('projectTools.forget')}
            </Button>
          </div>
          {copy.sessions.map(s => (
            <button
              key={s.id}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SESSION_EVENT, { detail: { sessionId: s.id } }))}
              className="mt-2 block w-full truncate text-left text-meta text-fg-muted hover:text-fg"
            >
              {s.title} · {s.state === 'idle' ? tr('projectTools.stopped') : tr('projectTools.running')}
            </button>
          ))}
        </article>
      ))}
      {preview && (
        <ConfirmDialog
          title={tr('projectTools.previewCreate')}
          description={
            <div className="flex flex-col gap-2 break-all">
              <p>{preview.path}</p>
              <p>{preview.branch}</p>
              <code>{preview.commit}</code>
              <p>{tr('projectTools.copyCommitHint')}</p>
            </div>
          }
          confirmLabel={tr('projectTools.create')}
          cancelLabel={tr('projectTools.cancel')}
          busy={busy}
          error={error}
          onConfirm={() => void create()}
          onCancel={() => setPreview(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={tr(removing.forget ? 'projectTools.forget' : 'projectTools.remove')}
          description={
            <div className="flex flex-col gap-2 break-all">
              <p>{removing.copy.path}</p>
              <p>{removing.copy.branch}</p>
              <p>{tr(removing.forget ? 'projectTools.confirmForgetCopy' : 'projectTools.confirmRemoveCopy')}</p>
              {removing.leftover && !removing.forget && (
                <p className="text-danger">{tr('projectTools.leftoverWarning')}</p>
              )}
              {(removing.copy.dirty || removing.leftover) && !removing.forget && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={removing.force}
                    onChange={e => setRemoving({ ...removing, force: e.target.checked })}
                  />
                  {tr(removing.leftover ? 'projectTools.deleteLeftoverFiles' : 'projectTools.discardCopyChanges')}
                </label>
              )}
            </div>
          }
          confirmLabel={tr('projectTools.remove')}
          cancelLabel={tr('projectTools.cancel')}
          danger
          busy={busy}
          confirmDisabled={(removing.copy.dirty || removing.leftover) && !removing.forget && !removing.force}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
