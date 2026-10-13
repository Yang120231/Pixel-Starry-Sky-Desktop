// 顶栏的「本机 | 云端」切换（docs/ui/layout-v2.md §4）：两段，本机直接切回；云端那半点开菜单列出远程机器（SSH）。
// 点能用的机器：切过去再选工作区；点不能用的：打开管理窗口去连接；「添加 SSH 机器」直接打开空表单。
import { useState } from 'react'
import { Check, ChevronDown, Cloud, Monitor, Plus, Server, Settings2 } from 'lucide-react'
import { cn, Popover, SEGMENT_TRACK, segmentItem, useToast } from '@/ui'
import { useI18n } from '@/i18n/I18nProvider'
import { translateMessage } from '@/i18n/core'
import { openMachineManager, openWorkspacePicker, selectMachine, useMachines } from './store'
import { cloudMachines, switchView, usableMachine } from './switchModel'

// 样式和侧栏「对话 | 代码」同一套（ui/Segmented.tsx 的 SEGMENT_TRACK / segmentItem）
const HALF = 'gap-1.5 px-2 text-meta @max-[680px]:px-1.5'
const MENU_ROW = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-fg hover:bg-hover'

export function MachineSwitch() {
  const { t } = useI18n()
  const toast = useToast()
  const state = useMachines(),
    view = switchView(state),
    cloud = cloudMachines(state)
  const current = state.machines.find(m => m.id === state.currentId)
  const [open, setOpen] = useState(false)
  const cloudLabel = view.name ? t('machines.cloudCurrent', { name: view.name }) : t('machines.cloud')
  // 切过去再选工作区；本机那半在已经是本机时不做事
  const choose = (id: string) => {
    setOpen(false)
    void selectMachine(id).then(
      () => openWorkspacePicker(),
      (e: Error) => toast(translateMessage(e.message)),
    )
  }
  return (
    <div
      role="group"
      aria-label={t('machines.group')}
      data-machine-menu
      // 和右边的打开方式、右侧面板按钮隔开 8px，自成一组
      className={cn(SEGMENT_TRACK, 'relative mr-1.5')}
    >
      <button
        type="button"
        aria-pressed={view.side === 'local'}
        title={t('machines.local')}
        onClick={() => (view.side === 'local' ? setOpen(false) : choose('local'))}
        className={cn(segmentItem(view.side === 'local'), HALF)}
      >
        <Monitor size={14} strokeWidth={1.5} />
        <span className="@max-[680px]:hidden">{t('machines.local')}</span>
      </button>
      <button
        type="button"
        aria-pressed={view.side === 'cloud'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current?.host ? `${current.username}@${current.host}` : cloudLabel}
        onMouseDown={e => open && e.stopPropagation()}
        onClick={() => setOpen(v => !v)}
        className={cn(segmentItem(view.side === 'cloud'), HALF, open && view.side !== 'cloud' && 'bg-hover text-fg')}
      >
        {view.warn && <span className="size-1.5 shrink-0 rounded-full bg-warn" />}
        <Cloud size={14} strokeWidth={1.5} />
        <span className="max-w-40 truncate @max-[680px]:hidden">{cloudLabel}</span>
        <ChevronDown size={12} strokeWidth={1.5} className="-ml-0.5 text-fg-faint @max-[680px]:hidden" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="end" className="w-72">
        <p className="px-2 pt-1 pb-1.5 text-meta text-fg-muted">{t('machines.cloudList')}</p>
        {cloud.length === 0 && <p className="px-2 py-1.5 text-ui text-fg-faint">{t('machines.cloudEmpty')}</p>}
        {cloud.map(m => {
          const ok = usableMachine(m),
            here = m.id === state.currentId
          return (
            <button
              key={m.id}
              type="button"
              data-menu-item
              title={`${m.username}@${m.host}:${m.port}`}
              onClick={() => {
                if (!ok) {
                  setOpen(false)
                  openMachineManager()
                } else if (here) setOpen(false)
                else choose(m.id)
              }}
              className={cn(MENU_ROW, here && 'bg-selected hover:bg-selected')}
            >
              <Server size={15} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.name}</span>
                <span className="block truncate text-meta text-fg-faint">
                  {m.username}@{m.host}
                </span>
              </span>
              {!ok && <span className="shrink-0 text-meta text-fg-faint">{t(`machines.${m.status}`)}</span>}
              {ok && here && <Check size={14} strokeWidth={1.75} className="shrink-0 text-online" />}
            </button>
          )
        })}
        <div role="separator" className="my-1 border-t border-line-subtle" />
        <button
          type="button"
          data-menu-item
          onClick={() => {
            setOpen(false)
            openMachineManager({ add: true })
          }}
          className={MENU_ROW}
        >
          <Plus size={15} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
          {t('machines.add')}
        </button>
        <button
          type="button"
          data-menu-item
          onClick={() => {
            setOpen(false)
            openMachineManager()
          }}
          className={MENU_ROW}
        >
          <Settings2 size={15} strokeWidth={1.5} className="shrink-0 text-fg-secondary" />
          {t('machines.manage')}
        </button>
      </Popover>
    </div>
  )
}
