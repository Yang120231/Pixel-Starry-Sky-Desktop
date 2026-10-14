// 设置 › 模型与额度：新任务的默认引擎，和每个引擎各自的默认额度来源、模型、线路、推理强度（docs/ui/engine-defaults.md）。
// 两个引擎的默认本来就分开存（account/platform.ts），这里按引擎读写；默认引擎和推理强度和「本机引擎」页共用同一份宿主设置
import { useState } from 'react'
import type { Effort, EngineId } from '@pixelsky/protocol'
import { Check, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
import { EngineIcon, Segmented, Select, cn } from '@/ui'
import {
  billingLabel,
  formatMultiplier,
  groupsForModel,
  platformModels,
  setDefaultCustom,
  setDefaultGroup,
  setDefaultModel,
  setDefaultSelfModel,
  setDefaultSource,
  usePlatform,
  type CreditSource,
} from '@/features/account/platform'
import { providersFor, resolveCustomModel, useProviders } from '@/features/account/providers'
import { EFFORT_LABEL, isLive, selfModelOptions, useEngineState } from '@/features/engine'
import { useEngineCatalog } from '@/features/engine/catalog'
import { bridge, redetectEngines } from '@/features/engine/store'
import { demo, isDemo } from '@/data/demo'
import type { EngineLite } from '@/data'
import { SettingRow } from '../SettingRow'
import { effortChoices, engineConfigurable, followedModel, keepEffort } from './engineDefaultsModel'

const ENGINES: EngineId[] = ['claude', 'codex']
const TAB_KEY = 'pixelsky.settings.models-engine'

function readTab(): EngineId {
  try {
    return localStorage.getItem(TAB_KEY) === 'codex' ? 'codex' : 'claude'
  } catch {
    return 'claude'
  }
}

// 演示模式：默认引擎和推理强度只在内存里（同 EnginesSection）
let demoDefaultEngine: EngineId = 'claude'
const demoEfforts: Partial<Record<EngineId, Effort | null>> = {}

const statusText = (status: string): string =>
  status === 'missing'
    ? tr('settings.engines.parts.notInstalled')
    : status === 'outdated'
      ? tr('settings.engines.parts.outdatedVersion')
      : status === 'error'
        ? tr('settings.engines.parts.detectionFailed')
        : tr('session.ModelSourceMenu.comingSoon2')

export function EngineDefaults({ onOpenEngines }: { onOpenEngines?: () => void }) {
  useI18n()
  const liveEngines = useEngineState(s => s.engines)
  const liveDefaults = useEngineState(s => s.defaults)
  const engines: EngineLite[] = isLive ? liveEngines : isDemo ? demo().engines.status : []
  const [demoEngine, setDemoEngine] = useState(demoDefaultEngine)
  const defaultEngine = isLive ? (liveDefaults?.engine ?? 'claude') : demoEngine
  const [tab, setTabState] = useState<EngineId>(readTab)
  const [error, setError] = useState<string | null>(null)
  const setTab = (next: EngineId): void => {
    setTabState(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // 只是记住看的是哪一页
    }
  }
  const info = (id: EngineId): EngineLite | undefined => engines.find(e => e.id === id)
  const chooseDefault = (id: EngineId): void => {
    setError(null)
    if (!bridge) {
      demoDefaultEngine = id
      setDemoEngine(id)
      return
    }
    bridge.setDefaultEngine(id).catch((e: Error) => setError(e.message))
  }
  const name = (id: EngineId): string => info(id)?.name ?? (id === 'claude' ? 'Claude Code' : 'Codex')

  return (
    <>
      <SettingRow title={tr('engineDefaults.defaultEngine')} description={tr('engineDefaults.defaultEngineHint')}>
        <div className="flex flex-col gap-1.5">
          <Segmented<EngineId>
            label={tr('engineDefaults.defaultEngine')}
            value={defaultEngine}
            onChange={id => {
              if (engineConfigurable(info(id)?.status)) chooseDefault(id)
            }}
            options={ENGINES.map(id => ({ value: id, label: name(id) }))}
          />
          {ENGINES.filter(id => id !== defaultEngine && !engineConfigurable(info(id)?.status) && info(id)).map(id => (
            <p key={id} className="text-meta text-fg-faint">
              {tr('engineDefaults.cannotDefault', { name: name(id), status: statusText(info(id)!.status) })}
            </p>
          ))}
          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}
        </div>
      </SettingRow>

      <div data-engine-defaults className="mt-2 rounded-lg border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-2.5">
          <span className="text-ui font-medium text-fg">{tr('engineDefaults.forEngine')}</span>
          <div role="tablist" aria-label={tr('engineDefaults.forEngine')} className="flex gap-1">
            {ENGINES.map(id => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-meta',
                  tab === id ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <EngineIcon engine={id} size={13} />
                {name(id)}
                {id === defaultEngine && <span className="text-fg-faint">· {tr('engineDefaults.isDefault')}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 pb-1">
          {engineConfigurable(info(tab)?.status) ? (
            <DefaultsFor key={tab} engine={tab} info={info(tab)!} />
          ) : (
            <div className="flex items-center justify-between gap-3 py-4 text-meta text-fg-muted">
              <span>
                {tr('engineDefaults.unavailable', {
                  name: name(tab),
                  status: info(tab) ? statusText(info(tab)!.status) : tr('settings.engines.parts.notInstalled'),
                })}
              </span>
              {onOpenEngines && (
                <button type="button" onClick={onOpenEngines} className="shrink-0 text-accent-fg hover:underline">
                  {tr('settings.models.ModelsSection.engineSettings')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** 一个引擎的默认：额度来源 → 来源对应的模型 / 线路 / 接口 → 推理强度 */
function DefaultsFor({ engine, info }: { engine: EngineId; info: EngineLite }) {
  useI18n()
  const platform = usePlatform(engine)
  const catalog = useEngineCatalog(engine)
  const catalogModels = catalog?.models ?? (isDemo && engine === 'claude' ? demo().engines.catalog.models : undefined)
  const models = platformModels(platform.groups)
  const routes = groupsForModel(platform.groups, platform.model)
  const endpoints = providersFor(useProviders().providers, engine)
  const endpoint = endpoints.find(p => p.id === platform.providerId) ?? endpoints[0]
  const followed = followedModel(catalog)
  const engineName = info.name

  // 这一页选的默认模型（按来源），推理强度的档位跟着它
  const chosenModel =
    platform.source === 'platform'
      ? platform.model
      : platform.source === 'custom'
        ? resolveCustomModel(endpoint, platform.customModel)
        : platform.selfModel
  const config = useEngineState(s => s.config)
  const [demoEffort, setDemoEffort] = useState<Effort | null>(demoEfforts[engine] ?? 'high')
  const effort = isLive ? (config?.[engine]?.defaults.effort ?? null) : demoEffort
  const choices = effortChoices(
    chosenModel,
    catalogModels,
    platform.source === 'self' ? followed : null,
    info.caps.efforts,
  )
  const shownEffort = keepEffort(effort, choices)
  const [effortError, setEffortError] = useState<string | null>(null)
  const saveEffort = (next: Effort | null): void => {
    setEffortError(null)
    if (!bridge) {
      demoEfforts[engine] = next
      setDemoEffort(next)
      return
    }
    bridge.setConfig(engine, { defaults: { effort: next } }).catch((e: Error) => setEffortError(e.message))
  }

  const selfOptions = selfModelOptions(engine, catalogModels).map(m => ({
    value: m.value ?? '',
    // 「默认」那一项写上实际会用哪个模型（Codex 报 currentModel）
    label:
      m.value === null && followed ? tr('engineDefaults.followCurrent', { label: m.label, model: followed }) : m.label,
    hint: m.hint,
  }))

  return (
    <>
      <SettingRow
        title={tr('settings.models.ModelsSection.defaultCreditSource')}
        description={tr('settings.models.ModelsSection.platformBilledThroughPixel')}
      >
        <Segmented<CreditSource>
          label={tr('settings.models.ModelsSection.defaultCreditSource')}
          value={platform.source}
          onChange={source => setDefaultSource(source, engine)}
          options={[
            { value: 'platform', label: tr('session.ModelSourceMenu.platform') },
            { value: 'self', label: tr('session.ModelSourceMenu.ownAccount') },
            { value: 'custom', label: tr('customApi.source') },
          ]}
        />
      </SettingRow>

      {platform.source === 'custom' ? (
        <SettingRow title={tr('customApi.defaultEndpoint')} description={tr('customApi.defaultEndpointHint')}>
          {endpoints.length === 0 ? (
            <p className="text-meta text-fg-faint">{tr('customApi.noEndpointForEngine')}</p>
          ) : (
            <div className="flex max-w-lg flex-wrap gap-2">
              <Select
                label={tr('customApi.defaultEndpoint')}
                className="min-w-0 flex-1"
                value={endpoint?.id ?? ''}
                onChange={id =>
                  setDefaultCustom(
                    id,
                    resolveCustomModel(
                      endpoints.find(p => p.id === id),
                      platform.customModel,
                    ),
                    engine,
                  )
                }
                options={endpoints.map(p => ({ value: p.id, label: p.name }))}
              />
              <Select
                label={tr('settings.models.ModelsSection.defaultModel')}
                mono
                className="min-w-0 flex-1"
                disabled={!endpoint || endpoint.models.length === 0}
                value={resolveCustomModel(endpoint, platform.customModel) ?? ''}
                onChange={v => endpoint && setDefaultCustom(endpoint.id, v, engine)}
                options={(endpoint?.models ?? []).map(m => ({ value: m.id, label: m.id }))}
              />
            </div>
          )}
        </SettingRow>
      ) : platform.source === 'platform' ? (
        <>
          <SettingRow
            title={tr('settings.models.ModelsSection.defaultModel')}
            description={tr('engineDefaults.platformModelHint', { name: engineName })}
          >
            <Select
              label={tr('settings.models.ModelsSection.defaultModel')}
              mono
              className="w-full max-w-sm"
              disabled={models.length === 0}
              value={platform.model ?? ''}
              placeholder={
                platform.email
                  ? tr('settings.models.ModelsSection.noModelsAvailable')
                  : tr('settings.models.ModelsSection.availableAfterSignIn')
              }
              onChange={v => setDefaultModel(v, engine)}
              options={models.map(m => ({ value: m, label: m }))}
            />
          </SettingRow>
          <SettingRow
            title={tr('settings.models.ModelsSection.defaultRoute')}
            description={tr('settings.models.ModelsSection.onlyRoutesSupportingDefault')}
          >
            {routes.length === 0 ? (
              <p className="text-meta text-fg-faint">
                {platform.email
                  ? tr('settings.models.ModelsSection.noRoutesAvailable')
                  : tr('settings.models.ModelsSection.availableAfterSignIn')}
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-label={tr('settings.models.ModelsSection.defaultRoute')}
                className="flex max-w-md flex-col gap-1"
              >
                {routes.map(g => {
                  const selected = g.id === platform.groupId
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setDefaultGroup(g.id, engine)}
                      className={cn(
                        'flex items-center gap-3 rounded-md border px-3 py-2 text-left',
                        selected ? 'border-line-strong bg-selected' : 'border-line hover:bg-hover',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui text-fg">{g.name}</span>
                        <span className="block truncate text-meta text-fg-muted">
                          {billingLabel(g)}
                          {g.description ? ` · ${g.description}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-ui text-fg-secondary tabular-nums">
                        {formatMultiplier(g.rate_multiplier)}
                      </span>
                      <Check size={15} className={cn('shrink-0', selected ? 'text-fg-secondary' : 'invisible')} />
                    </button>
                  )
                })}
              </div>
            )}
          </SettingRow>
        </>
      ) : (
        <SettingRow
          title={tr('settings.models.ModelsSection.defaultModel')}
          description={
            engine === 'claude'
              ? tr('settings.models.ModelsSection.claudeCodeModelAliases')
              : tr('engineDefaults.selfModelHint', { name: engineName })
          }
        >
          <div className="flex flex-col gap-1.5">
            <Select
              label={tr('settings.models.ModelsSection.defaultModel')}
              className="w-full max-w-sm"
              value={platform.selfModel ?? ''}
              onChange={v => setDefaultSelfModel(v || null, engine)}
              options={selfOptions}
            />
            <SignInLine engine={engine} info={info} />
          </div>
        </SettingRow>
      )}

      <SettingRow title={tr('engineDefaults.effort')} description={tr('engineDefaults.effortHint')}>
        <div className="flex flex-col gap-1.5">
          <Select
            label={tr('engineDefaults.effort')}
            className="w-full max-w-sm"
            value={shownEffort ?? ''}
            onChange={v => saveEffort((v || null) as Effort | null)}
            options={[
              { value: '', label: tr('settings.engines.EngineDetail.default', { p0: engineName }) },
              ...choices.map(x => ({ value: x, label: EFFORT_LABEL[x] })),
            ]}
          />
          {effort && !shownEffort && (
            <p className="text-meta text-fg-faint">
              {tr('engineDefaults.effortUnsupported', { effort: EFFORT_LABEL[effort], name: engineName })}
            </p>
          )}
          {effortError && (
            <p role="alert" className="text-meta text-danger">
              {effortError}
            </p>
          )}
        </div>
      </SettingRow>
    </>
  )
}

/** 自有额度下面一行：本机引擎登录了没有；没登录时写怎么登录，可以重新检测 */
function SignInLine({ engine, info }: { engine: EngineId; info: EngineLite }) {
  useI18n()
  const [checking, setChecking] = useState(false)
  if (info.status === 'ready')
    return <p className="text-meta text-success">{tr('engineDefaults.signedIn', { name: info.name })}</p>
  return (
    <p className="flex items-center gap-2 text-meta text-warn">
      <span>{tr(engine === 'codex' ? 'engineDefaults.signInCodex' : 'engineDefaults.signInClaude')}</span>
      {isLive && (
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            setChecking(true)
            void redetectEngines().finally(() => setChecking(false))
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          <RefreshCw size={11} className={cn(checking && 'animate-spin')} />
          {tr('engineDefaults.recheck')}
        </button>
      )}
    </p>
  )
}
