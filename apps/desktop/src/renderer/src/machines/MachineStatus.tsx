import { useI18n } from '@/i18n/I18nProvider'
import { openMachineManager, useMachines } from './store'
export function MachineStatus() {
  const { t } = useI18n(), state = useMachines(), current = state.machines.find(m => m.id === state.currentId)
  if (!current || ['local','connected'].includes(current.status)) return null
  return <div role="status" className="flex shrink-0 items-center gap-3 border-b border-line bg-subtle px-4 py-2 text-meta text-warn"><span className="flex-1">{t('machines.unknownRunState')}</span><button onClick={openMachineManager} className="shrink-0 underline">{t('machines.reconnect')}</button></div>
}
