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
import { Button, IconButton } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { useComposerController } from '@/features/engine'
import { OVERLAY_EVENT, collectOverlays, overlayHidesBrowser, pointShowsPlaceholder } from './browserOverlay'
import { PreviewViewport } from './PreviewViewport'
import { useProjectContext } from './projectContext'
import { FIELD, NoProject, ToolError, useOperation } from './ToolsUi'
import type { BrowserAnnotation, BrowserState } from '../../../../shared/types/project-browser'
import type { WorkspaceRef } from '../../../../shared/types/workspace'
import { demo as demoData } from '@/data/demo'
import { isPortUrl, parsePort, portUrl, sameService } from '@/features/coding/bottom/portsModel'
import { usePortState } from '@/features/session/live/portTips'

export function BrowserTab({
  requested,
  onHandled,
}: {
  requested?: { ref: WorkspaceRef; url: string; seq: number } | null
  /** 请求已经交给浏览器：外面把它清掉。切对话时 BrowserBody 会按对话重建，不清的话切回来会再打开一次 */
  onHandled?: (seq: number) => void
}) {
  const ctx = useProjectContext()
  return ctx.ref ? (
    <BrowserBody
      key={ctx.key + ':' + JSON.stringify(ctx.ref)}
      target={ctx.ref}
      demo={ctx.demo}
      requested={requested}
      onHandled={onHandled}
    />
  ) : (
    <NoProject />
  )
}
function BrowserBody({
  target,
  demo,
  requested,
  onHandled,
}: {
  target: WorkspaceRef
  demo: boolean
  requested?: { ref: WorkspaceRef; url: string; seq: number } | null
  onHandled?: (seq: number) => void
}) {
  useI18n()
  const [state, setState] = useState<BrowserState | null>(
    demo ? structuredClone(demoData().projectTools.browser) : null,
  )
  const [address, setAddress] = useState(''),
    [note, setNote] = useState(''),
    [notesOpen, setNotesOpen] = useState(false)
  /** 确认框里待发送的批注：发送后只移除这几条，确认期间新加的保留 */
  const [send, setSend] = useState<{
    sessionId: string
    text: string
    pageId: string
    notes: BrowserAnnotation[]
  } | null>(null)
  /** 刚发出去、已从列表移除的批注：提示几秒，可以放回列表（不撤回已发出的消息） */
  const [sent, setSent] = useState<{ pageId: string; notes: BrowserAnnotation[] } | null>(null)
  const controller = useComposerController(send?.sessionId ?? target.sessionId ?? null)
  /** 被弹出层挡住、视图藏起来时铺在占位框里的截图（定格画面）；没有时 null */
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null),
    scope = useRef(''),
    requestedSeq = useRef(0)
  const { busy, error, setError, run } = useOperation()
  const page = state?.pages.find(p => p.id === state.activeId)
  const [port, setPort] = useState('')
  const found = usePortState(target.sessionId).found
  const openUrl = (url: string) =>
    run(async () => {
      const same = isPortUrl(url) ? state?.pages.find(p => sameService(p.url, url)) : undefined
      const browser = window.pixelsky!.projectBrowser
      setState(await (same ? browser.select(target, same.id) : browser.navigate(target, null, url)))
    })
  const openPort = (n: number | null) => {
    if (n) void openUrl(portUrl(n)).then(ok => ok && setPort(''))
  }
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
    if (!sent) return
    const timer = window.setTimeout(() => setSent(null), 6000)
    return () => window.clearTimeout(timer)
  }, [sent])
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
    onHandled?.(requested.seq)
    void openUrl(requested.url)
  }, [requested, state?.scope])
  useEffect(() => {
    if (demo || !page) return
    // 网页视图是盖在窗口上的原生视图，要跟着占位框的位置走。原来每一帧都量一次：窗口因此按屏幕刷新率一直重绘
    // （docs/ui/performance.md）。现在只在可能挪动的时候量：占位框或窗口大小变了、弹窗开关、拖动和过渡动画期间
    // 逐帧跟一小段；另外每半秒兜底量一次（不请求重绘）
    let frame = 0,
      until = 0,
      prior = '',
      stopped = false
    // 弹出层自己变高 / 变宽（展开明细）要重新判断：对当前存在的弹出层挂 ResizeObserver，弹出层没了就摘掉
    const watched = new Set<Element>()
    const overlayResize = new ResizeObserver(() => follow())
    const watchOverlays = (now: Element[]) => {
      for (const el of watched)
        if (!now.includes(el)) {
          overlayResize.unobserve(el)
          watched.delete(el)
        }
      for (const el of now)
        if (!watched.has(el)) {
          watched.add(el)
          overlayResize.observe(el)
        }
    }
    const sync = () => {
      if (stopped) return
      const element = viewport.current,
        r = element?.getBoundingClientRect()
      // 只有模态对话框、设置对话框，或和占位框重叠的弹出层 / 菜单才藏；不挡到网页的不藏
      const overlays = collectOverlays()
      watchOverlays(overlays.map(o => o.element))
      const covered =
        !!r &&
        overlayHidesBrowser(
          r,
          overlays.map(o => o.candidate),
        )
      const placeable =
        !!r &&
        r.width > 40 &&
        r.height > 40 &&
        !document.hidden &&
        r.right <= innerWidth + 1 &&
        r.bottom <= innerHeight + 1
      const visible =
        placeable && !covered && !!element && pointShowsPlaceholder(element, r.x + r.width / 2, r.y + r.height / 2)
      const rect = visible && r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
      // 只是被挡住（认得出的弹出层，或中心点被别的元素盖着）：藏之前截一张图顶替（定格画面），挡的东西没了再放回真网页
      const freeze = !rect && placeable
      const hash = JSON.stringify(rect) + ':' + freeze + ':' + page.id
      if (hash === prior) return
      prior = hash
      const fail = (e: Error) => {
        if (!stopped) setError(e.message)
      }
      if (freeze) {
        void window
          .pixelsky!.projectBrowser.viewport(target, null, { freeze: true })
          .then(result => {
            if (!stopped && prior === hash) setSnapshot(result?.snapshot ?? null)
          })
          .catch(fail)
        return
      }
      void window
        .pixelsky!.projectBrowser.viewport(target, rect)
        .then(() => {
          // 真网页放回去之后再撤掉截图，中间不闪
          if (rect) requestAnimationFrame(() => !stopped && prior === hash && setSnapshot(null))
        })
        .catch(fail)
      if (!rect) setSnapshot(null)
    }
    const loop = () => {
      sync()
      frame = !stopped && performance.now() < until ? requestAnimationFrame(loop) : 0
    }
    /** 接下来 ms 毫秒里每帧跟一次（0：下一帧量一次） */
    const follow = (ms = 0) => {
      until = Math.max(until, performance.now() + ms)
      if (!frame) frame = requestAnimationFrame(loop)
    }
    const once = () => follow()
    const transition = () => follow(700)
    const pointer = (e: PointerEvent) => {
      if (e.buttons) follow(150)
    }
    const resize = new ResizeObserver(once)
    if (viewport.current) resize.observe(viewport.current)
    resize.observe(document.body)
    // 菜单、对话框都挂在 body 下面
    const portals = new MutationObserver(once)
    portals.observe(document.body, { childList: true })
    const events: [EventTarget, string, EventListener][] = [
      [window, 'resize', once],
      [document, 'visibilitychange', once],
      [document, 'pointerdown', once],
      [document, 'pointerup', once],
      [document, 'pointermove', pointer as EventListener],
      [document, 'keydown', once],
      [document, 'scroll', once],
      [document, 'transitionrun', transition],
      [document, 'transitionend', once],
      [document, 'animationstart', transition],
      [document, 'animationend', once],
      // 弹出层开关（Popover、Toast、窗口布局……，browserOverlay.ts 的 notifyOverlayChange）：下一帧就量，不等兜底轮询
      [window, OVERLAY_EVENT, once],
    ]
    for (const [t, name, fn] of events) t.addEventListener(name, fn, { capture: true, passive: true })
    const fallback = window.setInterval(sync, 500)
    // 弹出层存在期间（下拉滚动、弹窗只挪位置不变大小，ResizeObserver 看不到）每 150ms 兜底量一次，没有弹出层时不量
    const popoverFallback = window.setInterval(() => {
      if (watched.size) sync()
    }, 150)
    sync()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      window.clearInterval(fallback)
      window.clearInterval(popoverFallback)
      overlayResize.disconnect()
      resize.disconnect()
      portals.disconnect()
      for (const [t, name, fn] of events) t.removeEventListener(name, fn, { capture: true })
      setSnapshot(null)
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
        {snapshot && (
          <img
            src={snapshot}
            alt=""
            aria-hidden
            data-browser-snapshot
            draggable={false}
            className="pointer-events-none absolute inset-0 z-[1] size-full select-none"
          />
        )}
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
            {!page && !demo && (
              <div data-port-entry className="pointer-events-auto mt-2 flex w-full max-w-72 flex-col gap-2">
                <p>{tr('portTip.manualHint')}</p>
                <form
                  className="flex gap-1"
                  onSubmit={e => {
                    e.preventDefault()
                    openPort(parsePort(port))
                  }}
                >
                  <label className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-line bg-surface px-2.5 font-mono text-list focus-within:border-accent">
                    <span className="text-fg-faint">localhost:</span>
                    <input
                      inputMode="numeric"
                      value={port}
                      onChange={e => setPort(e.target.value)}
                      placeholder={tr('portTip.portPlaceholder')}
                      aria-label={tr('portTip.portPlaceholder')}
                      title={tr('portTip.portInvalid')}
                      className="min-w-0 flex-1 bg-transparent text-fg outline-none"
                    />
                  </label>
                  <Button type="submit" disabled={busy || parsePort(port) === null}>
                    {tr('projectTools.go')}
                  </Button>
                </form>
                {found.length > 0 && (
                  <div className="text-left text-fg-faint">
                    {tr('portTip.found')}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {found.map(f => (
                        <button
                          key={f.port}
                          type="button"
                          disabled={busy}
                          onClick={() => openPort(f.port)}
                          className="rounded-sm bg-subtle px-1.5 font-mono text-fg-secondary hover:bg-hover"
                        >
                          :{f.port}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
              {sent?.pageId === page.id && (
                <div className="flex items-center gap-2 rounded-md bg-accent-soft px-2.5 py-1.5 text-meta text-accent-fg">
                  <span className="min-w-0 flex-1">
                    {tr('projectTools.annotationSent', { p0: String(sent.notes.length) })}
                  </span>
                  <button
                    disabled={busy}
                    className="shrink-0 underline"
                    onClick={() =>
                      void run(async () => {
                        const notes = sent.notes
                        setSent(null)
                        for (const a of notes)
                          setState(await window.pixelsky!.projectBrowser.annotate(target, page.id, a.text))
                      })
                    }
                  >
                    {tr('projectTools.restoreAnnotation')}
                  </button>
                </div>
              )}
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
                      pageId: page.id,
                      notes: page.annotations,
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
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-list">{send.text}</pre>
              <p className="mt-2 text-meta text-fg-muted">{tr('projectTools.annotationSendHint')}</p>
            </>
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
              // 已发送的批注从列表移除，不用再手动删
              for (const a of send.notes)
                setState(await window.pixelsky!.projectBrowser.removeAnnotation(target, send.pageId, a.id))
              setSent({ pageId: send.pageId, notes: send.notes })
            })
          }
          onCancel={() => setSend(null)}
        />
      )}
    </div>
  )
}
