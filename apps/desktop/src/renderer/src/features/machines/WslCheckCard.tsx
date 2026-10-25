// WSL 检查卡片（wsl-mode.plan.md §3.3）：第一次选某个发行版、或连接没过时逐项显示检查结果，给可复制的修复命令
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Circle, CheckCircle2, XCircle, X } from 'lucide-react'
import { Button, CopyButton, IconButton, Spinner, cn, useToast } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { machineErrorText } from './errorText'
import type { TranslationKey } from '../../../../shared/i18n/translate'
import type { CheckItem } from '../../../../shared/types/machines'
import {
  checkWsl,
  chooseWsl,
  closeWslCheck,
  openWslTerminal,
  setWslNode,
  updateWslCheck,
  useMachines,
  useWslCheck,
} from './store'
import { itemView, requiredReady, sortCheckItems } from './wslCheckModel'

const ICON = {
  ok: <CheckCircle2 size={15} strokeWidth={1.5} className="text-success" />,
  fail: <XCircle size={15} strokeWidth={1.5} className="text-danger" />,
  warn: <AlertCircle size={15} strokeWidth={1.5} className="text-warn" />,
  info: <Circle size={15} strokeWidth={1.5} className="text-fg-faint" />,
}
const NODE_FIELD =
  'h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 font-mono text-meta text-fg outline-none focus:border-fg-faint'

function Command({ text }: { text: string }) {
  return (
    <div className="mt-1.5 flex items-start gap-1 rounded-md border border-line bg-subtle py-1 pr-1 pl-2.5">
      <code className="selectable min-w-0 flex-1 py-0.5 font-mono text-meta break-all whitespace-pre-wrap text-fg">
        {text}
      </code>
      <CopyButton text={text} iconOnly />
    </div>
  )
}

export function WslCheckCard() {
  const view = useWslCheck()
  return view ? <Card key={view.id} id={view.id} items={view.items} /> : null
}

function Card({ id, items: fresh }: { id: string; items: CheckItem[] | null }) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const machine = useMachines().machines.find(m => m.id === id)
  const root = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<'check' | 'start' | null>(null)
  const [nodeOpen, setNodeOpen] = useState(false),
    [nodePath, setNodePath] = useState(machine?.wsl?.nodePath ?? '')
  const items = sortCheckItems(fresh ?? machine?.wsl?.lastCheck?.items ?? [])
  const ready = requiredReady(items)
  const name = machine?.name ?? ''
  const fail = (e: unknown) => toast(machineErrorText(e, locale))
  const recheck = async () => {
    setBusy('check')
    try {
      updateWslCheck(id, await checkWsl(id))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  const saveNode = async (path: string | null) => {
    setBusy('check')
    try {
      await setWslNode(id, path)
      if (!path) setNodePath('')
      updateWslCheck(id, await checkWsl(id))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  const start = async () => {
    setBusy('start')
    try {
      if ((await chooseWsl(id, m => toast(machineErrorText(m, locale)))) === 'selected') closeWslCheck()
    } finally {
      setBusy(null)
    }
  }
  // 还没有任何检查结果时自动查一次
  useEffect(() => {
    if (items.length === 0 && machine?.status !== 'connecting') void recheck()
    root.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时自动查一次
  }, [])
  const tt = (key: string, params?: Record<string, string>) => t(key as TranslationKey, params)
  const row = (item: CheckItem): ReactNode => {
    const v = itemView(item)
    return (
      <li key={item.key} className="py-1.5">
        <div className="flex items-center gap-2 text-ui">
          <span className="shrink-0">{ICON[v.status]}</span>
          <span className="shrink-0 text-fg">{tt(v.label)}</span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-right text-meta',
              item.status === 'warn' ? 'text-warn' : item.status === 'fail' ? 'text-danger' : 'text-fg-faint',
            )}
            title={v.short && 'text' in v.short ? v.short.text : undefined}
          >
            {v.short && ('key' in v.short ? tt(v.short.key, v.short.params) : v.short.text)}
          </span>
        </div>
        {(v.line || v.reason || v.fix || item.key === 'node') && (
          <div className="pl-[23px] text-meta text-fg-muted">
            {v.line && <p className="selectable mt-1 font-mono break-all text-warn/90">{v.line}</p>}
            {v.reason && <p className="mt-1">{tt(v.reason)}</p>}
            {v.fix && <Command text={v.fix} />}
            {item.key === 'node' && item.status !== 'ok' && (
              <div className="mt-1.5">
                <span className="text-fg-faint">{t('wsl.card.nodeHint')}</span>
                <button type="button" className="underline hover:text-fg" onClick={() => setNodeOpen(open => !open)}>
                  {t('wsl.card.nodeSet')}
                </button>
                {nodeOpen && (
                  <div className="mt-1.5 flex gap-2">
                    <input
                      aria-label={t('wsl.card.nodeLabel')}
                      className={NODE_FIELD}
                      value={nodePath}
                      spellCheck={false}
                      placeholder={t('wsl.card.nodePlaceholder')}
                      onChange={e => setNodePath(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && busy === null && nodePath.trim() && !e.nativeEvent.isComposing)
                          void saveNode(nodePath.trim())
                      }}
                    />
                    <Button disabled={busy !== null || !nodePath.trim()} onClick={() => void saveNode(nodePath.trim())}>
                      {t('wsl.card.nodeSave')}
                    </Button>
                    {machine?.wsl?.nodePath && (
                      <Button variant="ghost" disabled={busy !== null} onClick={() => void saveNode(null)}>
                        {t('wsl.card.nodeClear')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </li>
    )
  }
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('wsl.card.title', { name })}
      tabIndex={-1}
      className="fixed inset-0 z-50 outline-none flex items-center justify-center bg-scrim p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget && !busy) closeWslCheck()
      }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape' && !busy && !e.nativeEvent.isComposing) closeWslCheck()
      }}
    >
      <div className="flex max-h-[88vh] w-[480px] max-w-full flex-col overflow-hidden rounded-xl border border-line-card bg-popover shadow-menu">
        <header className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-1">
          <h2 className="flex-1 text-ui font-semibold">{t('wsl.card.title', { name })}</h2>
          <IconButton icon={X} label={t('wsl.card.close')} onClick={() => !busy && closeWslCheck()} />
        </header>
        <div className="min-h-0 overflow-auto px-5 pb-2">
          <p className="mb-1 text-ui text-fg-secondary">{t('wsl.card.intro')}</p>
          {items.length === 0 ? (
            <p className="py-3 text-meta text-fg-faint">{t('wsl.card.empty')}</p>
          ) : (
            <ul>{items.map(row)}</ul>
          )}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 px-5 py-3">
          <Button onClick={() => void openWslTerminal(id).catch(fail)}>{t('wsl.card.terminal')}</Button>
          <Button variant={ready ? 'outline' : 'primary'} disabled={busy !== null} onClick={() => void recheck()}>
            {busy === 'check' && <Spinner size={13} />}
            {t('wsl.card.recheck')}
          </Button>
          {ready && (
            <Button variant="primary" disabled={busy !== null} onClick={() => void start()}>
              {busy === 'start' && <Spinner size={13} />}
              {t('wsl.card.start')}
            </Button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
