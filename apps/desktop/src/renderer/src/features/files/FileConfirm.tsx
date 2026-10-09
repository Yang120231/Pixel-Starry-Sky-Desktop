import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/ui'
import { dirtyFile, getFiles, saveFile, updateFile, useFiles } from './store'

type Pending = {
  ids: string[]
  action: string
  resolve: (ok: boolean) => void
  deferDiscard?: (apply: () => void) => void
}
let pending: Pending | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach(cb => cb())
export function confirmFiles(
  ids: string[],
  action = tr('editor.code.theme.close'),
  deferDiscard?: (apply: () => void) => void,
): Promise<boolean> {
  const dirty = getFiles().tabs.filter(t => ids.includes(t.id) && dirtyFile(t))
  if (!dirty.length) return Promise.resolve(true)
  if (pending) return Promise.resolve(false)
  return new Promise(resolve => {
    pending = { ids: dirty.map(t => t.id), action, resolve, deferDiscard }
    emit()
  })
}
export function FileConfirm() {
  useI18n()
  const request = useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pending,
  )
  const files = useFiles(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const finish = (ok: boolean): void => {
    const resolve = pending?.resolve
    pending = null
    emit()
    resolve?.(ok)
  }
  useEffect(() => {
    if (!request) return
    setError('')
    const before = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      if (before?.isConnected) before.focus()
    }
  }, [request])
  if (!request) return null
  const tabs = files.tabs.filter(t => request.ids.includes(t.id))
  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={tr('files.FileConfirm.filesHaveUnsavedChanges')}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4"
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape' && !busy) {
          e.preventDefault()
          finish(false)
        }
        if (e.key === 'Tab') {
          const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
          if ((e.shiftKey && i <= 0) || (!e.shiftKey && i === buttons.length - 1)) {
            e.preventDefault()
            buttons[e.shiftKey ? buttons.length - 1 : 0]?.focus()
          }
        }
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-line-card bg-popover p-5 shadow-menu">
        <p className="text-ui font-medium text-fg">
          {tabs.length === 1
            ? tr('files.FileConfirm.hasUnsavedChanges', { p0: tabs[0].name })
            : tr('files.FileConfirm.filesHaveUnsavedChanges2', { p0: tabs.length })}
        </p>
        <p className="mt-2 text-meta text-fg-muted">
          {request.action}
          {tr('files.FileConfirm.chooseHowToHandle')}
        </p>
        {tabs.length > 1 && (
          <p className="mt-2 max-h-24 overflow-auto text-meta text-fg-secondary">{tabs.map(t => t.path).join('、')}</p>
        )}
        {error && (
          <p role="status" className="mt-3 text-meta text-danger">
            {translateMessage(error)}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button disabled={busy} onClick={() => finish(false)}>
            {tr('account.AccountMenu.cancel')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              const discard = () => {
                for (const tab of tabs)
                  updateFile(tab.id, {
                    draft: tab.document?.kind === 'text' ? tab.document.content.replace(/\r\n/g, '\n') : '',
                  })
              }
              if (request.deferDiscard) request.deferDiscard(discard)
              else discard()
              finish(true)
            }}
          >
            {tr('files.FileConfirm.discardChanges')}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void (async () => {
                for (const tab of tabs)
                  if (!(await saveFile(tab.id))) {
                    setError(
                      getFiles().tabs.find(t => t.id === tab.id)?.error ?? tr('files.FileConfirm.saveDidNotComplete'),
                    )
                    setBusy(false)
                    return
                  }
                if (getFiles().tabs.some(t => request.ids.includes(t.id) && dirtyFile(t))) {
                  setError(tr('files.FileConfirm.newEditsWereMade'))
                  setBusy(false)
                  return
                }
                setBusy(false)
                finish(true)
              })()
            }}
          >
            {tabs.length > 1 || request.action === '退出应用' || request.action === 'Quit application'
              ? tr('files.FileConfirm.saveAll')
              : tr('files.FileConfirm.save')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
