import { useState } from 'react'
import { Play, RotateCw, Settings2, Square } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '@/i18n/core'
import { Popover, PopoverItem } from '@/ui/Popover'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { cn, useComingSoon } from '@/ui'
import { isDemo } from '@/data'
import { codingLayout } from '../layoutStore'
import { useServices } from '../services'
import { useCodingWorkspace } from '../workspace'
import { primaryService, serviceActions } from './runModel'
import type { ServiceDefinition } from '../../../../../shared/types/project-tools'

const STATUS_KEYS = {
  stopped: 'projectTools.stopped',
  starting: 'projectTools.starting',
  running: 'projectTools.running',
  stopping: 'projectTools.stopping',
  failed: 'projectTools.failedStatus',
} as const

const DOT: Record<ServiceDefinition['status'], string> = {
  running: 'bg-active',
  failed: 'bg-danger',
  starting: 'bg-warn',
  stopping: 'bg-warn',
  stopped: 'bg-fg-faint',
}

const ICON_BUTTON =
  'flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent'

interface Pending {
  service: ServiceDefinition
  action: 'start' | 'restart'
}

/** 顶栏的运行胶囊：主服务的状态点 + 名字 + 停止 / 启动 + 重启；点主体列出全部服务 */
export function RunWidget() {
  useI18n()
  const { ref } = useCodingWorkspace()
  const { services } = useServices(ref)
  const comingSoon = useComingSoon()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const manage = (): void => {
    setOpen(false)
    codingLayout.showRight('sandbox')
  }
  const stop = async (s: ServiceDefinition): Promise<void> => {
    if (isDemo) return comingSoon(s.name)
    try {
      // 不传 force：强制停止只在环境面板里
      await window.pixelsky!.projectTools.stopService(s.id)
    } catch (e) {
      comingSoon((e as Error).message)
    }
  }
  const ask = (service: ServiceDefinition, action: 'start' | 'restart'): void => {
    if (isDemo) return comingSoon(service.name)
    setOpen(false)
    setError(null)
    setPending({ service, action })
  }
  const confirm = async (): Promise<void> => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const api = window.pixelsky!.projectTools
      if (pending.action === 'restart') await api.restartService(pending.service.id)
      else await api.startService(pending.service.id)
      setPending(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!ref) return null
  const main = primaryService(services)
  if (!main)
    return (
      <button
        type="button"
        data-run-widget
        onClick={manage}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-list text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Play size={14} strokeWidth={1.5} className="shrink-0" />
        <span className="@max-[999px]:hidden">{tr('coding.top.run.add')}</span>
      </button>
    )

  const act = serviceActions(main.status)
  return (
    <div className="relative">
      <div data-run-widget className="flex h-7 items-center gap-0.5 rounded-md border border-line-card pl-1 pr-0.5">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={tr('coding.top.run.menu')}
          onClick={() => setOpen(o => !o)}
          className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-list text-fg hover:bg-hover"
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', DOT[main.status])} />
          <span className="max-w-32 truncate">{main.name}</span>
        </button>
        {act.stop ? (
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={tr('projectTools.stop')}
            title={tr('projectTools.stop')}
            onClick={() => void stop(main)}
          >
            <Square size={12} strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            className={ICON_BUTTON}
            disabled={!act.start}
            aria-label={tr('projectTools.start')}
            title={tr('projectTools.start')}
            onClick={() => ask(main, 'start')}
          >
            <Play size={12} strokeWidth={1.5} />
          </button>
        )}
        <button
          type="button"
          className={ICON_BUTTON}
          disabled={!act.restart}
          aria-label={tr('projectTools.restart')}
          title={tr('projectTools.restart')}
          onClick={() => ask(main, 'restart')}
        >
          <RotateCw size={12} strokeWidth={1.5} />
        </button>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} className="right-0 top-full mt-1 w-72">
        {services.map(s => {
          const a = serviceActions(s.status)
          return (
            <div key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-list text-fg">
              <span className={cn('size-1.5 shrink-0 rounded-full', DOT[s.status])} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="shrink-0 text-meta text-fg-muted">
                {s.port ? ':' + s.port + ' · ' : ''}
                {tr(STATUS_KEYS[s.status])}
              </span>
              {a.stop && (
                <button
                  type="button"
                  className={ICON_BUTTON}
                  aria-label={tr('projectTools.stop')}
                  onClick={() => void stop(s)}
                >
                  <Square size={12} strokeWidth={1.5} />
                </button>
              )}
              {a.start && (
                <button
                  type="button"
                  className={ICON_BUTTON}
                  aria-label={tr('projectTools.start')}
                  onClick={() => ask(s, 'start')}
                >
                  <Play size={12} strokeWidth={1.5} />
                </button>
              )}
              {a.restart && (
                <button
                  type="button"
                  className={ICON_BUTTON}
                  aria-label={tr('projectTools.restart')}
                  onClick={() => ask(s, 'restart')}
                >
                  <RotateCw size={12} strokeWidth={1.5} />
                </button>
              )}
            </div>
          )
        })}
        <div className="my-1 h-px bg-line-layout" />
        <PopoverItem icon={<Settings2 size={16} strokeWidth={1.5} className="shrink-0" />} onClick={manage}>
          {tr('coding.top.run.manage')}
        </PopoverItem>
      </Popover>
      {pending && (
        <ConfirmDialog
          title={tr('projectTools.confirmService')}
          description={
            <div className="flex flex-col gap-2">
              <p>{pending.service.name}</p>
              <pre className="whitespace-pre-wrap break-all">{pending.service.command}</pre>
              <p className="break-all">{pending.service.cwd}</p>
              <p>
                {pending.service.port ? 'PORT=' + pending.service.port : ''} {pending.service.envNames.join(', ')}
              </p>
              <p>{tr(('projectTools.serviceAction.' + pending.action) as 'projectTools.serviceAction.start')}</p>
            </div>
          }
          confirmLabel={tr(pending.action === 'restart' ? 'projectTools.restart' : 'projectTools.start')}
          cancelLabel={tr('projectTools.cancel')}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
