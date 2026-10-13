// 顶栏的「本机 ▾」（docs/ui/ui-polish-2026-10-13.md §6）：点开列出机器，点一台直接切过去再选工作区；
// 没连上的点了打开管理窗口去连接。最下面「管理机器…」——原来顶栏单独的「云主机」图标打开的也是它，已并进来。
import { useState } from 'react'
import { ChevronDown, Monitor, Server, Settings2 } from 'lucide-react'
import { cn, Popover, PopoverItem, useToast } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { translateMessage } from '@/i18n/core'
import { openMachineManager, openWorkspacePicker, selectMachine, useMachines } from './store'

const usable = (status: string): boolean => status === 'local' || status === 'connected'

export function MachineMenu({ className }: { className: string }) {
  const { t, text } = useI18n()
  const toast = useToast()
  const state = useMachines(),
    machine = state.machines.find(m => m.id === state.currentId)
  const [open, setOpen] = useState(false)
  const nameOf = (m: { id: string; name: string }): string => (m.id === 'local' ? text('本机') : m.name)
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        data-machine-menu
        title={machine?.host ? `${machine.name} · ${machine.username}@${machine.host}` : t('machines.switch')}
        aria-label={t('machines.switch')}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={e => open && e.stopPropagation()}
        onClick={() => setOpen(v => !v)}
        className={cn(className, open && 'bg-active')}
      >
        <span
          className={cn('size-1.5 shrink-0 rounded-full', machine && usable(machine.status) ? 'bg-online' : 'bg-warn')}
        />
        <span className="max-w-40 truncate text-meta @max-[680px]:hidden">{machine ? nameOf(machine) : ''}</span>
        <ChevronDown size={13} strokeWidth={1.5} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="top-full right-0 mt-1 w-64">
        <p className="px-2 pt-1 pb-1.5 text-meta text-fg-muted">{t('machines.switch')}</p>
        {state.machines.map(m => {
          const Icon = m.id === 'local' ? Monitor : Server
          return (
            <PopoverItem
              key={m.id}
              icon={<Icon size={15} strokeWidth={1.5} className="text-fg-secondary" />}
              selected={m.id === state.currentId}
              hint={usable(m.status) ? undefined : t(`machines.${m.status}`)}
              title={m.host ? `${m.username}@${m.host}:${m.port}` : undefined}
              onClick={() => {
                setOpen(false)
                if (m.id === state.currentId) return
                if (!usable(m.status)) openMachineManager()
                else
                  void selectMachine(m.id).then(
                    () => openWorkspacePicker(),
                    (e: Error) => toast(translateMessage(e.message)),
                  )
              }}
            >
              <span className="block truncate">{nameOf(m)}</span>
            </PopoverItem>
          )
        })}
        <div role="separator" className="my-1 border-t border-line-subtle" />
        <PopoverItem
          icon={<Settings2 size={15} strokeWidth={1.5} className="text-fg-secondary" />}
          onClick={() => {
            setOpen(false)
            openMachineManager()
          }}
        >
          {t('machines.manage')}
        </PopoverItem>
      </Popover>
    </span>
  )
}
