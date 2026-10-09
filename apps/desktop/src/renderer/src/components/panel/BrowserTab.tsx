import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  MessageSquareText,
  Plus,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useComposerController } from '@/engine'
import { PreviewViewport } from './PreviewViewport'
import { useProjectContext } from './projectContext'
import { FIELD, NoProject, ToolError, useOperation } from './ToolsUi'
import type { BrowserState } from '../../../../shared/types/project-browser'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { demo as demoData } from '@/data/demo'

export function BrowserTab({ requested }: { requested?: { ref: WorkspaceRef; url: string; seq: number } | null }) {
  const ctx = useProjectContext()
  return ctx.ref ? (
    <BrowserBody key={ctx.key + ':' + JSON.stringify(ctx.ref)} target={ctx.ref} demo={ctx.demo} requested={requested} />
  ) : (
    <NoProject />
  )
}
function BrowserBody({
  target,
  demo,
  requested,
}: {
  target: WorkspaceRef
  demo: boolean
  requested?: { ref: WorkspaceRef; url: string; seq: number } | null
}) {
  useI18n()
  const [state, setState] = useState<BrowserState | null>(
    demo ? structuredClone(demoData().projectTools.browser) : null,
  )
  const [address, setAddress] = useState(''),
    [note, setNote] = useState(''),
    [notesOpen, setNotesOpen] = useState(false)
  const [send, setSend] = useState<{ sessionId: string; text: string } | null>(null)
  const controller = useComposerController(send?.sessionId ?? target.sessionId ?? null)
  const viewport = useRef<HTMLDivElement>(null),
    scope = useRef(''),
    requestedSeq = useRef(0)
  const { busy, error, setError, run } = useOperation()
  const page = state?.pages.find(p => p.id === state.activeId)
  useEffect(() => {
    if (demo) return
    let gone = false
    void window
      .pixelsky!.projectBrowser.state(target)
      .then(next => {
        if (!gone) {
          scope.current = next.scope
          setState(next)
        }
      })
      .catch(e => {
        if (!gone) setError(e.message)
      })
    const off = window.pixelsky!.projectBrowser.onChange(next => {
      if (!gone && next.scope === scope.current) setState(next)
    })
    return () => {
      gone = true
      off()
      void window.pixelsky?.projectBrowser.viewport(target, null).catch(() => {})
    }
  }, [])
  useEffect(() => {
    setAddress(page?.url ?? '')
  }, [page?.id, page?.url])
  useEffect(() => {
    if (
      !requested ||
      requestedSeq.current === requested.seq ||
      !state ||
      demo ||
      JSON.stringify(requested.ref) !== JSON.stringify(target)
    )
      return
    requestedSeq.current = requested.seq
    void run(async () => setState(await window.pixelsky!.projectBrowser.navigate(target, null, requested.url)))
  }, [requested, state?.scope])
  useEffect(() => {
    if (demo || !page) return
    let frame = 0,
      prior = '',
      stopped = false
    const sync = () => {
      if (stopped) return
      const element = viewport.current,
        r = element?.getBoundingClientRect()
      const overlay = document.querySelector('[role="dialog"],[role="menu"],[role="listbox"],[data-settings-dialog]')
      const visible =
        !!r &&
        r.width > 40 &&
        r.height > 40 &&
        !overlay &&
        !document.hidden &&
        r.right <= innerWidth + 1 &&
        r.bottom <= innerHeight + 1 &&
        !!element?.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      const rect = visible && r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
      const hash = JSON.stringify(rect) + ':' + page.id
      if (hash !== prior) {
        prior = hash
        void window.pixelsky!.projectBrowser.viewport(target, rect).catch(e => {
          if (!stopped) setError(e.message)
        })
      }
      frame = requestAnimationFrame(sync)
    }
    sync()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      void window.pixelsky?.projectBrowser.viewport(target, null).catch(() => {})
    }
  }, [page?.id, demo])
  const navigate = () =>
    run(async () => {
      if (demo) return
      setState(await window.pixelsky!.projectBrowser.navigate(target, page?.id ?? null, address))
    })
  const action = (kind: 'back' | 'forward' | 'reload' | 'stop' | 'close', id = page?.id) =>
    run(async () => {
      if (!id) return
      if (demo) {
        if (kind === 'close') setState(s => (s ? { ...s, pages: s.pages.filter(p => p.id !== id), activeId: null } : s))
        return
      }
      setState(await window.pixelsky!.projectBrowser.action(target, id, kind))
    })
  const select = (id: string | null) =>
    run(async () => {
      if (demo) setState(s => (s ? { ...s, activeId: id } : s))
      else setState(await window.pixelsky!.projectBrowser.select(target, id))
    })
  const annotate = () =>
    run(async () => {
      if (!page || !note.trim()) return
      if (demo)
        setState(s =>
          s
            ? {
                ...s,
                pages: s.pages.map(p =>
                  p.id === page.id
                    ? {
                        ...p,
                        annotations: [...p.annotations, { id: crypto.randomUUID(), url: p.url, text: note.trim() }],
                      }
                    : p,
                ),
              }
            : s,
        )
      else setState(await window.pixelsky!.projectBrowser.annotate(target, page.id, note))
      setNote('')
    })
  return (
    <div data-tools-browser className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {state?.pages.map(p => (
            <div
              key={p.id}
              className={
                'flex shrink-0 items-center rounded-md border ' +
                (p.id === state.activeId ? 'border-line bg-surface' : 'border-transparent')
              }
            >
              <button
                title={p.url}
                disabled={busy}
                onClick={() => void select(p.id)}
                className="max-w-36 truncate px-2 py-1.5 text-meta text-fg-secondary"
              >
                {p.title}
              </button>
              <IconButton
                size={24}
                iconSize={12}
                icon={X}
                label={tr('projectTools.closePage')}
                disabled={busy}
                onClick={() => void action('close', p.id)}
              />
            </div>
          ))}
        </div>
        <IconButton
          icon={Plus}
          label={tr('projectTools.newPage')}
          disabled={busy || (state?.pages.length ?? 0) >= 12}
          onClick={() => void select(null)}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          icon={ArrowLeft}
          label={tr('projectTools.back')}
          disabled={busy || !page?.canBack}
          onClick={() => void action('back')}
        />
        <IconButton
          icon={ArrowRight}
          label={tr('projectTools.forward')}
          disabled={busy || !page?.canForward}
          onClick={() => void action('forward')}
        />
        <IconButton
          icon={page?.loading ? Square : RefreshCw}
          label={tr(page?.loading ? 'projectTools.stopLoading' : 'projectTools.reload')}
          disabled={busy || !page}
          onClick={() => void action(page?.loading ? 'stop' : 'reload')}
        />
        <form
          onSubmit={e => {
            e.preventDefault()
            void navigate()
          }}
          className="flex min-w-0 flex-1 gap-1"
        >
          <input
            aria-label={tr('projectTools.enterUrl')}
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder={tr('projectTools.enterUrl')}
            className={FIELD}
          />
          <Button type="submit" disabled={busy || !address.trim()}>
            {tr('projectTools.go')}
          </Button>
        </form>
        <IconButton
          icon={ExternalLink}
          label={tr('projectTools.openExternal')}
          disabled={!page || busy || demo}
          onClick={() =>
            void run(async () => {
              if (page) await window.pixelsky!.projectTools.openExternal(page.url)
            })
          }
        />
      </div>
      <ToolError error={error || page?.error || ''} />
      <div
        ref={viewport}
        data-browser-viewport
        className="relative flex min-h-24 flex-1 flex-col overflow-hidden rounded-lg border border-line-card bg-surface"
      >
        {demo && page ? (
          <PreviewViewport />
        ) : (
          <div className="pointer-events-none flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-meta text-fg-muted">
            <Globe size={24} />
            <p>
              {page
                ? tr(page.loading ? 'projectTools.loading' : 'projectTools.browserTitle')
                : tr('projectTools.browserEmpty')}
            </p>
            {!page && <p>{tr('projectTools.browserEmptyHint')}</p>}
          </div>
        )}
      </div>
      {page && (
        <div className="flex shrink-0 flex-col gap-2">
          <button
            onClick={() => setNotesOpen(!notesOpen)}
            className="flex items-center gap-2 text-list text-fg-secondary"
          >
            <MessageSquareText size={15} />
            {tr('projectTools.annotation')} ({page.annotations.length})
          </button>
          {notesOpen && (
            <div className="flex max-h-52 flex-col gap-2 overflow-auto">
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void annotate()
                }}
                className="flex gap-2"
              >
                <input
                  value={note}
                  maxLength={4000}
                  onChange={e => setNote(e.target.value)}
                  placeholder={tr('projectTools.annotationPlaceholder')}
                  className={FIELD}
                />
                <Button type="submit" disabled={busy || !note.trim()}>
                  {tr('projectTools.save')}
                </Button>
              </form>
              {page.annotations.map(a => (
                <div key={a.id} className="flex items-start gap-2 text-meta text-fg-secondary">
                  <p className="min-w-0 flex-1 break-words whitespace-pre-wrap" title={a.url}>
                    {a.text}
                  </p>
                  <IconButton
                    icon={Trash2}
                    label={tr('projectTools.remove')}
                    onClick={() =>
                      void run(async () => {
                        if (demo)
                          setState(s =>
                            s
                              ? {
                                  ...s,
                                  pages: s.pages.map(p =>
                                    p.id === page.id
                                      ? { ...p, annotations: p.annotations.filter(n => n.id !== a.id) }
                                      : p,
                                  ),
                                }
                              : s,
                          )
                        else setState(await window.pixelsky!.projectBrowser.removeAnnotation(target, page.id, a.id))
                      })
                    }
                  />
                </div>
              ))}
              <Button
                disabled={!target.sessionId || !page.annotations.length || busy || demo}
                title={!target.sessionId ? tr('projectTools.noConversation') : undefined}
                onClick={() => {
                  if (target.sessionId)
                    setSend({
                      sessionId: target.sessionId,
                      text: page.annotations
                        .map(a => tr('projectTools.annotationMessage', { p0: a.url, p1: a.text }))
                        .join('\n\n'),
                    })
                }}
              >
                {tr('projectTools.sendAnnotation')}
              </Button>
            </div>
          )}
        </div>
      )}
      {send && (
        <ConfirmDialog
          title={tr('projectTools.sendAnnotation')}
          description={
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-list">{send.text}</pre>
          }
          confirmLabel={tr('projectTools.sendAnnotation')}
          cancelLabel={tr('projectTools.cancel')}
          busy={busy}
          error={error}
          onConfirm={() =>
            void run(async () => {
              if (!controller) throw new Error(tr('projectTools.noConversation'))
              await controller.submit(send.text)
              setSend(null)
            })
          }
          onCancel={() => setSend(null)}
        />
      )}
    </div>
  )
}
