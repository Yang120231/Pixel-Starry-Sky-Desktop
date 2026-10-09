import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../../i18n/core'
// 设置 › 模型与额度（docs/ui/source-switch.md §3.6）：新任务的默认额度来源、模型、线路；
// 平台可用线路一览；本机引擎检测结果；自定义 API 占位。已开始的会话在输入框菜单里单独改。
import { useEffect, useRef, useState } from 'react'
import { Check, LogIn, RefreshCw } from 'lucide-react'
import { Button, EngineIcon, Segmented, Select, Spinner, cn } from '@/ui'
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
  setDefaultGroup,
  setDefaultModel,
  setDefaultSelfModel,
  setDefaultSource,
  setModelHidden,
  showAllModels,
  usePlatform,
  type CreditSource,
} from '@/features/account/platform'
import { SELF_MODELS, isLive, useEngineState } from '@/features/engine'
import { GroupTitle, SectionTitle, SettingRow } from '../SettingRow'
import { Switch } from '@/features/session/ComposerMenus'
import { takeModelsScroll } from './scroll'
import { RequestRetrySettings } from './RequestRetrySettings'
import { demo, isDemo } from '@/data/demo'

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
  const models = platformModels(platform.groups)
  const routes = groupsForModel(platform.groups, platform.model)
  const visibilityRef = useRef<HTMLDivElement>(null)
  const [modelQuery, setModelQuery] = useState('')
  useEffect(() => {
    if (takeModelsScroll()) visibilityRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <section>
      <SectionTitle>{tr('settings.models.ModelsSection.modelsCredits')}</SectionTitle>
      <p className="-mt-2 mb-5 text-meta text-fg-muted">{tr('settings.models.ModelsSection.defaultsForNewTasks')}</p>

      <SettingRow
        title={tr('settings.models.ModelsSection.defaultCreditSource')}
        description={tr('settings.models.ModelsSection.platformBilledThroughPixel')}
      >
        <Segmented<CreditSource>
          label={tr('settings.models.ModelsSection.defaultCreditSource')}
          value={platform.source}
          onChange={setDefaultSource}
          options={[
            {
              value: 'platform',
              get label() {
                return tr('session.ModelSourceMenu.platform')
              },
            },
            {
              value: 'self',
              get label() {
                return tr('session.ModelSourceMenu.ownAccount')
              },
            },
          ]}
        />
      </SettingRow>

      {platform.source === 'platform' ? (
        <>
          <SettingRow
            title={tr('settings.models.ModelsSection.defaultModel')}
            description={tr('settings.models.ModelsSection.modelsFromYourAvailable')}
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
              onChange={v => setDefaultModel(v)}
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
                      onClick={() => setDefaultGroup(g.id)}
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
          description={tr('settings.models.ModelsSection.claudeCodeModelAliases')}
        >
          <Select
            label={tr('settings.models.ModelsSection.defaultModel')}
            className="w-full max-w-sm"
            value={platform.selfModel ?? ''}
            onChange={v => setDefaultSelfModel(v || null)}
            options={SELF_MODELS.claude.map(m => ({ value: m.value ?? '', label: m.label, hint: m.hint }))}
          />
        </SettingRow>
      )}

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
              const lines = groupsForModel(platform.groups, m).length
              return (
                <div key={m} className="flex items-center gap-3 border-t border-line-subtle px-4 py-2 first:border-t-0">
                  <span
                    className={cn('min-w-0 flex-1 truncate font-mono text-meta', shown ? 'text-fg' : 'text-fg-faint')}
                  >
                    {m}
                  </span>
                  <span className="shrink-0 text-meta text-fg-faint">
                    {lines}
                    {tr('settings.models.ModelsSection.routes')}{' '}
                  </span>
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

      {/* 以后：自定义 API（docs/ui/source-switch.md §5） */}
      <GroupTitle>{tr('settings.models.ModelsSection.requestRetries')}</GroupTitle>
      <RequestRetrySettings />
      <GroupTitle>{tr('settings.models.ModelsSection.customApi')}</GroupTitle>
      <div className="mt-3 rounded-lg border border-dashed border-line px-4 py-4 text-meta text-fg-muted">
        {tr('settings.models.ModelsSection.comingSoonAddYour')}{' '}
      </div>
    </section>
  )
}
