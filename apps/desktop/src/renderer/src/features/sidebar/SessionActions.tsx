import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isLive } from '@/features/engine'
import { bridge, getEngineState } from '@/features/engine/store'
import { paneActions } from '@/features/panes/store'
import { SESSION_REMOVED_EVENT } from '@/features/engine/sessionLifecycle'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Toast } from '@/ui/Toast'
import { useI18n } from '@/i18n/I18nProvider'
import { translateMessage } from '@/i18n/core'
import { retainSessionFiles } from '@/features/files/store'
import { RenameSessionDialog } from './RenameSessionDialog'
import { isChatProject, normalizeSessionTitle } from '@pixelsky/protocol'
import { demo, demoSessionChanges } from '@/data/demo'
import { machineOf } from '@/features/machines/store'
import { sessionRecord } from '@/features/session/branch/store'
import { chatDeleteNote, type ChatDeleteNote } from './chatDeleteNote'
export interface SessionTarget {
  id: string
  title: string
  archived: boolean
  running: boolean
  bottomed?: boolean
  pinned?: boolean
}
type Action = 'archive' | 'restore' | 'delete' | 'rename' | 'bottom' | 'pin'
interface Context {
  request: (action: Action, target: SessionTarget) => void
  requestResult: (action: Action, target: SessionTarget) => Promise<boolean>
  /** 复制会话 ID 到剪贴板，成功后弹提示 */
  copyId: (target: SessionTarget) => void
  busy: boolean
}
const Context = createContext<Context | null>(null)
export function useSessionActions(): Context {
  const value = useContext(Context)
  if (!value) throw new Error('SessionActionsProvider missing')
  return value
}
interface Request {
  action: 'archive' | 'delete'
  target: SessionTarget
}
type ToastKind =
  | 'archive'
  | 'restore'
  | 'delete'
  | 'error'
  | 'rename'
  | 'bottom'
  | 'unbottom'
  | 'pin'
  | 'unpin'
  | 'copyId'
interface Toast {
  kind: ToastKind
  id: string
  title: string
  text?: string
  at: number
}
const TOAST_KEYS = {
  archive: 'session.archivedToast',
  restore: 'session.restoredToast',
  delete: 'session.deletedToast',
  rename: 'session.renamedToast',
  bottom: 'session.bottomToast',
  unbottom: 'session.unbottomToast',
  pin: 'session.pinToast',
  unpin: 'session.unpinToast',
  copyId: 'session.copiedId',
} as const
export function SessionActionsProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n(),
    [confirm, setConfirm] = useState<Request | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [toast, setToast] = useState<Toast | null>(null),
    working = useRef(false)
  const [rename, setRename] = useState<SessionTarget | null>(null)
  // 删「对话」的确认框：note 没有＝还在数文件夹（或数不出来），只显示不带文件那行的说明
  const [chat, setChat] = useState<{ id: string; note?: ChatDeleteNote } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const pendingResult = useRef<((ok: boolean) => void) | null>(null)
  const resolveResult = (ok: boolean): void => {
    pendingResult.current?.(ok)
    pendingResult.current = null
  }
  const cancelConfirm = (): void => {
    resolveResult(false)
    setConfirm(null)
    setChat(null)
    setRename(null)
    setError(null)
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
    })
  }
  useEffect(() => {
    const removed = (event: Event): void => {
      const ids = new Set((event as CustomEvent<{ ids: string[] }>).detail.ids)
      paneActions.closeSessions(ids)
    }
    window.addEventListener(SESSION_REMOVED_EVENT, removed)
    return () => window.removeEventListener(SESSION_REMOVED_EVENT, removed)
  }, [])
  const fresh = (target: SessionTarget): SessionTarget => {
    if (!isLive) {
      const change = demoSessionChanges()[target.id]
      return {
        ...target,
        title: change?.title ?? target.title,
        bottomed: change?.bottomedAt === undefined ? target.bottomed : !!change.bottomedAt,
        pinned: change?.pinnedAt === undefined ? target.pinned : !!change.pinnedAt,
        archived: change ? !!change.archivedAt : target.archived,
        running: change?.stopped ? false : target.running,
      }
    }
    const state = getEngineState(),
      summary = state.sessions.find(s => s.record.id === target.id),
      snapshot = state.snapshots[target.id],
      record = snapshot?.record ?? summary?.record
    return record
      ? {
          id: record.id,
          title: record.title,
          bottomed: !!record.bottomedAt,
          pinned: !!record.pinnedAt,
          archived: !!record.archivedAt,
          running: (snapshot?.state ?? summary?.state ?? 'idle') !== 'idle',
        }
      : target
  }
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])
  const apply = async (
    action: Exclude<Action, 'rename'>,
    target: SessionTarget,
    allowRunning: boolean,
  ): Promise<void> => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      const current = fresh(target)
      if (isLive && bridge) {
        if (action === 'delete') {
          retainSessionFiles(current.id)
          await bridge.deleteSession(current.id)
        } else if (action === 'bottom') await bridge.setSessionBottom(current.id, !current.bottomed)
        else if (action === 'pin') await bridge.setSessionPinned(current.id, !current.pinned)
        else await bridge.archiveSession(current.id, action === 'archive', allowRunning)
      } else
        demo().sessions.change(
          current.id,
          // 置顶和置底互斥，和主进程一样
          action === 'bottom'
            ? {
                bottomedAt: current.bottomed ? null : Date.now(),
                ...(current.bottomed ? {} : { pinnedAt: null }),
                archivedAt: current.archived ? (demoSessionChanges()[current.id]?.archivedAt ?? 1) : null,
              }
            : action === 'pin'
              ? {
                  pinnedAt: current.pinned ? null : Date.now(),
                  ...(current.pinned ? {} : { bottomedAt: null }),
                  archivedAt: current.archived ? (demoSessionChanges()[current.id]?.archivedAt ?? 1) : null,
                }
              : action === 'delete'
                ? { deleted: true, stopped: true }
                : {
                    archivedAt: action === 'archive' ? Date.now() : null,
                    stopped: action === 'archive' || demoSessionChanges()[current.id]?.stopped === true,
                  },
        )
      if (action === 'archive' || action === 'delete') paneActions.closeSessions(new Set([current.id]))
      setConfirm(null)
      setChat(null)
      setToast({
        kind:
          action === 'bottom' && current.bottomed ? 'unbottom' : action === 'pin' && current.pinned ? 'unpin' : action,
        id: current.id,
        title: current.title,
        at: Date.now(),
      })
      resolveResult(true)
    } catch (error) {
      if (action === 'archive' && (error as Error).message.includes('SESSION_RUNNING'))
        setConfirm({ action, target: { ...fresh(target), running: true } })
      else {
        const message = translateMessage((error as Error).message) || t('session.retry')
        if (confirm) setError(message)
        else {
          resolveResult(false)
          setToast({ kind: 'error', id: target.id, title: target.title, text: message, at: Date.now() })
        }
      }
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  const saveRename = async (title: string): Promise<void> => {
    if (!rename || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      const next = normalizeSessionTitle(title),
        current = fresh(rename)
      if (isLive && bridge) await bridge.renameSession(current.id, next)
      else
        demo().sessions.change(current.id, {
          title: next,
          archivedAt: current.archived ? (demoSessionChanges()[current.id]?.archivedAt ?? 1) : null,
        })
      setRename(null)
      setToast({ kind: 'rename', id: current.id, title: next, at: Date.now() })
      resolveResult(true)
      requestAnimationFrame(() => {
        if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
      })
    } catch (error) {
      setError(translateMessage((error as Error).message) || t('session.retry'))
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  const request = (action: Action, target: SessionTarget): void => {
    if (working.current) return
    const current = fresh(target)
    setError(null)
    returnFocus.current =
      document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(current.id)}"][aria-selected="true"]`) ??
      document.querySelector<HTMLElement>(`[data-session-row="${CSS.escape(current.id)}"] > button`)
    if (action === 'rename') setRename(current)
    else if (action === 'delete') {
      setConfirm({ action, target: current })
      const record = isLive ? sessionRecord(current.id) : null
      if (!record || !isChatProject(record.projectId)) return
      setChat({ id: record.id })
      void window.pixelsky!.files.listExisting({ sessionId: record.id }, '').then(
        listing => {
          const records = getEngineState().sessions.map(s => s.record),
            note = chatDeleteNote(record, records, listing, t('composer.file.listSep'))
          // 期间取消或换了别的会话：不写回
          setChat(c => (c?.id === record.id ? { id: record.id, note } : c))
        },
        () => {},
      )
    } else if (action === 'archive' && current.running) setConfirm({ action, target: current })
    else void apply(action, current, false)
  }
  const copyId = (target: SessionTarget): void => {
    // 引擎会话 id（没有就用本地 id）；演示模式直接用 target.id
    const record = isLive
      ? (getEngineState().snapshots[target.id]?.record ??
        getEngineState().sessions.find(s => s.record.id === target.id)?.record)
      : undefined
    const text = record?.engineSessionId ?? record?.id ?? target.id
    const write = window.pixelsky?.terminal
      ? window.pixelsky.terminal.clipboardWrite(text)
      : navigator.clipboard.writeText(text)
    void Promise.resolve(write).then(
      () => setToast({ kind: 'copyId', id: target.id, title: target.title, at: Date.now() }),
      () => setToast({ kind: 'error', id: target.id, title: target.title, text: t('session.retry'), at: Date.now() }),
    )
  }
  const selected = confirm ? fresh(confirm.target) : null
  const chatNote = confirm?.action === 'delete' && chat?.id === confirm.target.id ? chat : null
  const requestResult = (action: Action, target: SessionTarget): Promise<boolean> => {
    if (working.current || confirm || rename || pendingResult.current) return Promise.resolve(false)
    return new Promise(resolve => {
      pendingResult.current = resolve
      request(action, target)
    })
  }
  return (
    <Context.Provider value={{ request, requestResult, copyId, busy }}>
      {children}
      {rename && (
        <RenameSessionDialog
          key={rename.id}
          title={rename.title}
          busy={busy}
          error={error}
          onSave={title => void saveRename(title)}
          onCancel={cancelConfirm}
        />
      )}
      {confirm && selected && (
        <ConfirmDialog
          title={t(confirm.action === 'delete' ? 'session.deleteTitle' : 'session.archiveTitle', {
            title: selected.title,
          })}
          description={
            <>
              <p>
                {t(
                  confirm.action !== 'delete'
                    ? 'session.archiveDescription'
                    : chatNote
                      ? 'session.deleteChatDescription'
                      : 'session.deleteDescription',
                )}
              </p>
              {chatNote?.note && (
                <p className="mt-2">
                  {chatNote.note === 'shared'
                    ? t('session.deleteChatShared')
                    : chatNote.note === 'empty'
                      ? t('session.deleteChatEmpty')
                      : t(
                          machineOf(chatNote.id) === 'local'
                            ? 'session.deleteChatFiles'
                            : 'session.deleteChatFilesRemote',
                          chatNote.note,
                        )}
                </p>
              )}
              {(selected.running || confirm.target.running) && (
                <p className="mt-2 text-warn">{t('session.stopDescription')}</p>
              )}
            </>
          }
          confirmLabel={
            busy ? t('session.busy') : t(confirm.action === 'delete' ? 'session.delete' : 'session.archive')
          }
          cancelLabel={t('session.cancel')}
          busy={busy}
          error={error}
          danger={confirm.action === 'delete'}
          onConfirm={() => void apply(confirm.action, selected, true)}
          onCancel={cancelConfirm}
        />
      )}
      {toast && (
        <Toast data-session-toast className="py-2.5 text-list">
          <span className="min-w-0 break-words">
            {toast.kind === 'error' ? toast.text : t(TOAST_KEYS[toast.kind], { title: toast.title })}
          </span>
          {toast.kind === 'archive' && (
            <button
              disabled={busy}
              className="shrink-0 text-accent-fg underline"
              onClick={() =>
                void apply('restore', { id: toast.id, title: toast.title, archived: true, running: false }, false)
              }
            >
              {t('session.undo')}
            </button>
          )}
          <button
            aria-label={t('session.dismiss')}
            onClick={() => setToast(null)}
            className="shrink-0 rounded-sm p-1 text-fg-muted hover:bg-hover"
          >
            <X size={14} />
          </button>
        </Toast>
      )}
    </Context.Provider>
  )
}
