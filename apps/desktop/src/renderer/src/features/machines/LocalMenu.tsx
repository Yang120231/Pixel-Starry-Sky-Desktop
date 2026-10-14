// 「本机」下拉（wsl-mode.plan.md §3.1）：Windows 和每个 WSL 发行版；只在有 WSL 时由 MachineSwitch 打开
import { useEffect, useState, type RefObject } from 'react'
import { Check, Monitor, RefreshCw, SquareTerminal } from 'lucide-react'
import { cn, Popover, Spinner, useToast } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { machineErrorText } from './errorText'
import type { TranslationKey } from '../../../../shared/i18n/translate'
import { chooseWsl, openWorkspacePicker, refreshWsl, selectMachine, useMachines } from './store'
import { wslMachines, wslStatusLine, type WslStatusLine } from './switchModel'

const MENU_ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-fg hover:bg-hover'
const DOT: Record<WslStatusLine['tone'], string> = {
  ok: 'bg-online',
  idle: 'bg-fg-faint',
  warn: 'bg-warn',
  busy: '',
}

export function LocalMenu({
  open,
  onClose,
  anchor,
}: {
  open: boolean
  onClose: () => void
  anchor: RefObject<HTMLElement | null>
}) {
  const { t } = useI18n()
  const toast = useToast()
  const state = useMachines(),
    distros = wslMachines(state)
  const [detecting, setDetecting] = useState(false)
  const detect = () => {
    setDetecting(true)
    void refreshWsl()
      .catch(() => {})
      .finally(() => setDetecting(false))
  }
  // 打开时顺手刷新一次，不阻塞显示
  useEffect(() => {
    if (open) detect()
  }, [open])
  const statusText = (line: WslStatusLine): string => {
    const params = { ...line.params }
    if (params.problem) params.problem = t(params.problem as TranslationKey)
    if (params.code) params.error = machineErrorText(params.code)
    return t(line.key as TranslationKey, params)
  }
  const toWindows = () => {
    onClose()
    if (state.currentId === 'local') return
    void selectMachine('local').then(
      () => openWorkspacePicker(),
      (e: Error) => toast(machineErrorText(e)),
    )
  }
  const toDistro = (id: string) => {
    onClose()
    if (state.currentId === id || state.machines.find(m => m.id === id)?.status === 'connecting') return
    void chooseWsl(id, message => toast(machineErrorText(message)))
  }
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} className="w-80">
      <p className="px-2 pt-1 pb-1.5 text-meta text-fg-muted">{t('wsl.menu.title')}</p>
      <button
        type="button"
        data-menu-item
        onClick={toWindows}
        className={cn(MENU_ROW, state.currentId === 'local' && 'bg-selected hover:bg-selected')}
      >
        <Monitor size={15} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{t('wsl.menu.windows')}</span>
          <span className="block truncate text-meta text-fg-faint">{t('wsl.menu.windowsSub')}</span>
        </span>
        {state.currentId === 'local' && <Check size={14} strokeWidth={1.75} className="shrink-0 text-online" />}
      </button>
      {distros.map(m => {
        const line = wslStatusLine(m),
          here = m.id === state.currentId
        return (
          <button
            key={m.id}
            type="button"
            data-menu-item
            onClick={() => toDistro(m.id)}
            className={cn(MENU_ROW, here && 'bg-selected hover:bg-selected')}
          >
            <SquareTerminal size={15} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t('wsl.menu.distro', { name: m.name })}</span>
              <span className="flex items-center gap-1.5 text-meta text-fg-faint">
                {line.tone === 'busy' ? (
                  <Spinner size={10} />
                ) : (
                  <span className={cn('size-1.5 shrink-0 rounded-full', DOT[line.tone])} />
                )}
                <span className="truncate" title={statusText(line)}>
                  {statusText(line)}
                </span>
              </span>
            </span>
            {line.needsPrep && (
              <span className="shrink-0 rounded bg-warn/15 px-1.5 py-0.5 text-meta text-warn">
                {t('wsl.menu.needsPrep')}
              </span>
            )}
            {here && <Check size={14} strokeWidth={1.75} className="shrink-0 text-online" />}
          </button>
        )
      })}
      <div role="separator" className="my-1 border-t border-line-subtle" />
      <button type="button" data-menu-item onClick={detect} className={MENU_ROW}>
        <RefreshCw
          size={15}
          strokeWidth={1.5}
          className={cn('shrink-0 text-fg-secondary', detecting && 'animate-spin')}
        />
        {t('wsl.menu.recheck')}
      </button>
      <p className="px-2 pt-1 pb-1.5 text-meta text-fg-faint">{t('wsl.menu.note')}</p>
    </Popover>
  )
}
