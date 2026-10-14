import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../../i18n/core'
// 设置 › 模型与额度（docs/ui/source-switch.md §3.6）：新任务的默认引擎，各引擎的默认额度来源、模型、线路、推理强度（EngineDefaults.tsx）；
// 平台可用线路一览；本机引擎检测结果；自定义 API 的接口（docs/ui/custom-api.md）。已开始的会话在输入框菜单里单独改。
import type { EngineId } from '@pixelsky/protocol'
import { useEffect, useRef, useState } from 'react'
import { LogIn, RefreshCw } from 'lucide-react'
import { Button, EngineIcon, Spinner, Switch, cn } from '@/ui'
import { useAccount } from '@/features/account/useAccount'
import {
  billingLabel,
  formatMultiplier,
  groupProblem,
  MODEL_SEARCH_MIN,
  matchModels,
  groupsForModel,
  noRouteReason,
  platformModels,
  refreshPlatform,
  setModelHidden,
  showAllModels,
  usePlatform,
} from '@/features/account/platform'
import { isLive, useEngineState } from '@/features/engine'
import { GroupTitle, SectionTitle } from '../SettingRow'
import { takeModelsScroll } from './scroll'
import { RequestRetrySettings } from './RequestRetrySettings'
import { demo, isDemo } from '@/data/demo'
import { CustomApiSettings } from './CustomApiSettings'
import { EngineDefaults } from './EngineDefaults'
import { AiCommitSettings } from './AiCommitSettings'
import { ContextWindowInput } from './ContextWindowInput'
import { setContextWindow, useContextWindows } from './contextWindows'

const ENGINE_STATUS: Record<string, string> = {
  get ready() {
    return tr('settings.models.ModelsSection.ready')
  },
  get unauthenticated() {
    return tr('sidebar.SidebarFooter.notSignedIn')
  },
  get missing() {
    return tr('settings.engines.parts.notInstalled')
  },
  get outdated() {
    return tr('settings.engines.parts.outdatedVersion')
  },
  get error() {
    return tr('settings.engines.parts.detectionFailed')
  },
  get unsupported() {
    return tr('session.ModelSourceMenu.comingSoon2')
  },
}

export function ModelsSection({ onOpenEngines }: { onOpenEngines?: () => void }) {
  useI18n()
  const platform = usePlatform()
  const account = useAccount()
  const liveEngines = useEngineState(s => s.engines)
  const engines = isLive ? liveEngines : isDemo ? demo().engines.status : []
  const codexPlatform = usePlatform('codex')
  const claudeModels = platformModels(platform.groups)
  const codexModels = platformModels(codexPlatform.groups)
  // 菜单里显示的模型和上下文窗口：Claude Code 和 Codex 两边的模型合在一起（GitHub #20）
  const models = [...claudeModels, ...codexModels.filter(m => !claudeModels.includes(m))]
  const claudeWindows = useContextWindows('claude').platform
  const codexWindows = useContextWindows('codex').platform
  const [windowError, setWindowError] = useState<string | null>(null)
  const saveWindow = (model: string, value: number | null): void => {
    setWindowError(null)
    const engines: EngineId[] = [
      ...(claudeModels.includes(model) ? (['claude'] as const) : []),
      ...(codexModels.includes(model) ? (['codex'] as const) : []),
    ]
    Promise.all(engines.map(engine => setContextWindow(engine, 'platform', model, value))).catch((e: unknown) =>
      setWindowError((e as Error).message),
    )
  }
  const visibilityRef = useRef<HTMLDivElement>(null)
  const [modelQuery, setModelQuery] = useState('')
  useEffect(() => {
    if (takeModelsScroll()) visibilityRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <section>
      <SectionTitle>{tr('settings.models.ModelsSection.modelsCredits')}</SectionTitle>
      <p className="-mt-2 mb-5 text-meta text-fg-muted">{tr('settings.models.ModelsSection.defaultsForNewTasks')}</p>

      {/* 默认引擎，和每个引擎各自的默认（docs/ui/engine-defaults.md） */}
      <EngineDefaults onOpenEngines={onOpenEngines} />

      {/* 平台线路一览 */}
      <GroupTitle>{tr('session.ModelSourceMenu.platform')}</GroupTitle>
      {!platform.email ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
          <span className="text-meta text-fg-muted">{tr('settings.models.ModelsSection.signInToPixel')}</span>
          <Button variant="primary" icon={LogIn} onClick={() => void account.login()}>
            {tr('account.AccountMenu.signIn')}{' '}
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-meta text-fg-muted">
            <span className="min-w-0 truncate">
              {platform.email}
              {account.balanceText ? tr('settings.models.ModelsSection.balance', { p0: account.balanceText }) : ''}
            </span>
            <button
              type="button"
              disabled={platform.loading}
              onClick={() => void refreshPlatform()}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-hover hover:text-fg disabled:opacity-50"
            >
              <RefreshCw size={12} className={cn(platform.loading && 'animate-spin')} />
              {platform.loading ? tr('session.ModelSourceMenu.refreshing') : tr('account.AccountMenu.refresh')}
            </button>
          </div>
          {platform.groups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-meta text-fg-muted">
              {platform.loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  {tr('session.ModelSourceMenu.loadingRoutes')}{' '}
                </span>
              ) : (
                noRouteReason(platform, account.account?.balance ?? null).message
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line">
              {platform.groups.map(g => {
                const problem = groupProblem(g, account.account?.balance ?? null)
                return (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui text-fg">{g.name}</span>
                      <span className={cn('block text-meta', problem ? 'text-danger' : 'truncate text-fg-muted')}>
                        {billingLabel(g)} ·{' '}
                        {problem ?? tr('settings.models.ModelsSection.models', { p0: g.models.length })}
                      </span>
                    </span>
                    <span className="shrink-0 text-ui text-fg-secondary tabular-nums">
                      {formatMultiplier(g.rate_multiplier)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 菜单里显示的模型（§8）：只记隐藏的，线路新加的模型默认显示 */}
      {platform.email && models.length > 0 && (
        <div ref={visibilityRef} data-setting-title="菜单里显示的模型" className="mt-5 scroll-mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div>
              <div className="text-ui font-medium text-fg">{tr('settings.models.ModelsSection.modelsShownInMenu')}</div>
              <p className="mt-1 text-meta text-fg-muted">
                {tr('settings.models.ModelsSection.hiddenModelsAreRemoved')}
              </p>
              <p className="mt-1 text-meta text-fg-muted">{tr('contextWindow.platformHint')}</p>
              {windowError && (
                <p role="alert" className="mt-1 text-meta text-danger">
                  {translateMessage(windowError)}
                </p>
              )}
            </div>
            {platform.hiddenModels.some(m => models.includes(m)) && (
              <button
                type="button"
                onClick={showAllModels}
                className="shrink-0 text-meta text-accent-fg hover:underline"
              >
                {tr('settings.models.ModelsSection.showAll')}{' '}
              </button>
            )}
          </div>
          {models.length > MODEL_SEARCH_MIN && (
            <input
              value={modelQuery}
              onChange={e => setModelQuery(e.target.value)}
              placeholder={tr('session.ModelSourceMenu.searchModels')}
              aria-label={tr('session.ModelSourceMenu.searchModels')}
              spellCheck={false}
              className="mb-2 h-8 w-full max-w-xs rounded-md border border-line bg-subtle px-2.5 font-mono text-meta text-fg outline-none placeholder:font-sans placeholder:text-fg-faint focus:border-line-strong focus:bg-surface"
            />
          )}
          <div className="overflow-hidden rounded-lg border border-line">
            {matchModels(models, modelQuery).length === 0 && (
              <div className="px-4 py-2 text-meta text-fg-faint">{tr('session.ModelSourceMenu.noMatchingModels')}</div>
            )}
            {matchModels(models, modelQuery).map(m => {
              const shown = !platform.hiddenModels.includes(m)
              const lines =
                groupsForModel(platform.groups, m).length +
                (claudeModels.includes(m) ? 0 : groupsForModel(codexPlatform.groups, m).length)
              return (
                <div key={m} className="flex items-center gap-3 border-t border-line-subtle px-4 py-2 first:border-t-0">
                  <span
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-1.5 font-mono text-meta',
                      shown ? 'text-fg' : 'text-fg-faint',
                    )}
                  >
                    {!claudeModels.includes(m) && <EngineIcon engine="codex" size={12} />}
                    <span className="truncate">{m}</span>
                  </span>
                  <span className="shrink-0 text-meta text-fg-faint">
                    {tr(lines === 1 ? 'settings.models.ModelsSection.route' : 'settings.models.ModelsSection.routes', {
                      n: lines,
                    })}
                  </span>
                  <ContextWindowInput
                    value={claudeWindows[m] ?? codexWindows[m] ?? null}
                    label={tr('contextWindow.of', { model: m })}
                    commit="blur"
                    onChange={value => saveWindow(m, value)}
                  />
                  <Switch
                    checked={shown}
                    label={tr('settings.models.ModelsSection.showInMenu', { p0: m })}
                    onChange={on => setModelHidden(m, !on)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 本机引擎：详细设置（路径、环境变量、压缩模型）在「本机引擎」页 */}
      <GroupTitle>{tr('settings.models.ModelsSection.ownAccountLocalEngine')}</GroupTitle>
      <div className="mt-3 flex items-center gap-3 rounded-lg border border-line px-4 py-2.5">
        <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
          {engines.map(e => (
            <span key={e.id} className="inline-flex items-center gap-1.5 text-meta">
              <EngineIcon engine={e.id} size={14} />
              <span className="text-fg">{e.name}</span>
              <span className={e.status === 'ready' ? 'text-success' : 'text-fg-muted'}>
                {ENGINE_STATUS[e.status] ?? e.status}
                {e.status === 'ready' && e.version ? ` · ${e.version}` : ''}
              </span>
            </span>
          ))}
        </span>
        {onOpenEngines && (
          <button type="button" onClick={onOpenEngines} className="shrink-0 text-meta text-accent-fg hover:underline">
            {tr('settings.models.ModelsSection.engineSettings')}{' '}
          </button>
        )}
      </div>

      <GroupTitle>{tr('aiCommit.settings.title')}</GroupTitle>
      <AiCommitSettings />
      <GroupTitle>{tr('settings.models.ModelsSection.customApi')}</GroupTitle>
      <CustomApiSettings />
      <GroupTitle>{tr('settings.models.ModelsSection.requestRetries')}</GroupTitle>
      <RequestRetrySettings />
    </section>
  )
}
