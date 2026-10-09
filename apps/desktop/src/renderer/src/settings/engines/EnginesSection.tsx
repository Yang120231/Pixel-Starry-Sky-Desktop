import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 设置 › 本机引擎（docs/ui/engine-settings-redesign.md，参考 Mirasim 设置 › 智能体）：
// 列表页每个引擎一行（状态、版本、默认、设为默认），点进去是详情页（EngineDetail）。
// 真实数据：配置在引擎 store（主进程改了会广播 engine_config）；演示模式只改内存。
import { useEffect, useState } from 'react'
import { ChevronRight, CircleCheck } from 'lucide-react'
import type { EngineConfig, EngineConfigPatch, EngineId } from '@pixelsky/protocol'
import { EngineIcon, cn } from '@/components/ui'
import { bridge, isLive, useEngineState } from '@/engine'
import { SectionTitle } from '../SettingRow'
import { EngineDetail } from './EngineDetail'
import { openEngineDetail, useEngineDetail } from './nav'
import { DefaultBadge, ENGINE_STATUS } from './parts'
import { demo, isDemo } from '@/data/demo'
import type { EngineLite } from '@/data/types'

export function EnginesSection({ onOpenModels }: { onOpenModels?: () => void }) {
  useI18n()
  const liveEngines = useEngineState(s => s.engines)
  const liveConfig = useEngineState(s => s.config)
  const liveDefaults = useEngineState(s => s.defaults)
  const engines: EngineLite[] = isLive ? liveEngines : isDemo ? demo().engines.status : []
  // 演示模式：配置和默认引擎只在内存里（没有桥接也不是演示模式时，比如普通浏览器，是空列表）
  const [demoConfig, setDemoConfig] = useState<EngineConfig | null>(() => (isDemo ? demo().engines.config : null))
  const [demoDefault, setDemoDefault] = useState<EngineId>('claude')
  const config = isLive ? liveConfig : demoConfig
  const defaultEngine = isLive ? (liveDefaults?.engine ?? 'claude') : demoDefault
  const detail = useEngineDetail()
  const [error, setError] = useState<string | null>(null)

  // 离开这一页时回到列表
  useEffect(() => () => openEngineDetail(null), [])

  const save = async (engine: EngineId, patch: EngineConfigPatch): Promise<void> => {
    if (!bridge) {
      setDemoConfig(
        c =>
          c && {
            ...c,
            [engine]: { ...c[engine], ...patch, defaults: { ...c[engine].defaults, ...(patch.defaults ?? {}) } },
          },
      )
      return
    }
    // 主进程会广播 engine_config，store 跟着更新
    await bridge.setConfig(engine, patch)
  }
  const setDefault = async (engine: EngineId): Promise<void> => {
    setError(null)
    if (!bridge) {
      setDemoDefault(engine)
      setDemoConfig(c => c && { ...c, [engine]: { ...c[engine], hidden: false } })
      return
    }
    try {
      await bridge.setDefaultEngine(engine)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const open = detail ? engines.find(e => e.id === detail) : undefined
  if (open && config) {
    return (
      <EngineDetail
        key={open.id}
        engine={open}
        config={config[open.id]}
        isDefault={open.id === defaultEngine}
        onSave={patch => save(open.id, patch)}
        onSetDefault={() => setDefault(open.id)}
        onBack={() => openEngineDetail(null)}
        onOpenModels={onOpenModels}
      />
    )
  }

  return (
    <section>
      <SectionTitle>{tr('settings.engines.EnginesSection.message779')}</SectionTitle>
      <p className="-mt-2 mb-5 text-meta text-fg-muted">{tr('settings.engines.EnginesSection.message780')} </p>
      <div className="flex flex-col gap-2">
        {engines.length === 0 && (
          <div className="rounded-xl border border-line px-4 py-3 text-meta text-fg-muted">
            {tr('settings.engines.EnginesSection.message781')}
          </div>
        )}
        {engines.map(e => (
          <EngineRow
            key={e.id}
            engine={e}
            isDefault={e.id === defaultEngine}
            hidden={config?.[e.id]?.hidden ?? false}
            onOpen={() => openEngineDetail(e.id)}
            onSetDefault={() => void setDefault(e.id)}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-meta text-danger">
          {translateMessage(error)}
        </p>
      )}
    </section>
  )
}

/** 列表里的一行：点整行进详情；不支持的引擎不能点 */
function EngineRow({
  engine: e,
  isDefault,
  hidden,
  onOpen,
  onSetDefault,
}: {
  engine: EngineLite
  isDefault: boolean
  hidden: boolean
  onOpen: () => void
  onSetDefault: () => void
}) {
  useI18n()
  const unsupported = e.status === 'unsupported'
  const canDefault = !isDefault && !unsupported && e.status !== 'missing'
  return (
    <div
      data-setting-title={e.name}
      className={cn(
        'flex items-center gap-2 rounded-xl border border-line bg-surface/60 pr-3',
        !unsupported && 'hover:border-line-strong',
      )}
    >
      <button
        type="button"
        disabled={unsupported}
        onClick={onOpen}
        aria-label={tr('settings.engines.EnginesSection.message782', { p0: e.name })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-3 pl-4 text-left disabled:cursor-default"
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle',
            unsupported && 'opacity-60',
          )}
        >
          <EngineIcon engine={e.id} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn('text-ui font-medium', unsupported ? 'text-fg-muted' : 'text-fg')}>{e.name}</span>
            {isDefault && <DefaultBadge />}
            {hidden && !isDefault && (
              <span className="text-label text-fg-faint">{tr('settings.engines.EnginesSection.message783')}</span>
            )}
            {e.status === 'ready' ? (
              <span className="inline-flex items-center gap-1 text-meta text-success">
                <CircleCheck size={12} />
                {e.version ?? tr('settings.editor.EditorSection.message709')}
              </span>
            ) : (
              <span className={cn('text-meta', unsupported ? 'text-fg-faint' : 'text-warn')}>
                {ENGINE_STATUS[e.status] ?? e.status}
              </span>
            )}
          </span>
          {e.path && (
            <span className="mt-0.5 block truncate font-mono text-meta text-fg-muted" title={e.path}>
              {e.path}
            </span>
          )}
        </span>
        {!unsupported && <ChevronRight size={16} className="shrink-0 text-fg-faint" />}
      </button>
      {canDefault && (
        <button
          type="button"
          onClick={onSetDefault}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
        >
          {tr('session.ModelSourceMenu.message304')}{' '}
        </button>
      )}
    </div>
  )
}
