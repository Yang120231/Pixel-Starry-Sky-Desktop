import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 输入框的「引擎 / 额度来源 / 模型」菜单（docs/ui/source-switch.md §3.2）。
// 三段分开：引擎决定谁执行工具，额度来源决定模型请求走哪里、谁付费，模型列表跟着来源变。
// 平台时先选模型、再选线路（分组），线路在子页里，按倍率从低到高排。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, LogIn, RefreshCw } from 'lucide-react'
import type { EngineConfig, EngineId } from '@pixelsky/protocol'
import { EngineIcon, Popover, Spinner, cn } from '@/components/ui'
import { useAccount } from '@/account/useAccount'
import {
  billingLabel,
  formatMultiplier,
  groupsForModel,
  noRouteReason,
  platformModels,
  refreshPlatform,
  usePlatform,
  visibleModels,
  MODEL_SEARCH_MIN,
  matchModels,
  type CreditSource,
} from '@/account/platform'
import { SELF_MODELS, selfModelLabel, useEngineState, type SourceMenuController } from '@/engine'
import { useSettings } from '@/settings/SettingsProvider'
import { useEngineCatalog } from '@/engine/catalog'
import { requestModelsScroll } from '@/settings/models/scroll'
import { MenuRow, MenuTitle, TRIGGER } from './ComposerMenus'

const SOURCE_LABEL: Record<CreditSource, string> = {
  get platform() {
    return tr('session.ModelSourceMenu.message279')
  },
  get self() {
    return tr('session.ModelSourceMenu.message280')
  },
}

/** 菜单里的小号分段按钮 */
function MiniSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ value: T; label: string; icon?: React.ReactNode; disabled?: boolean; title?: string }>
  value: T
  onChange: (v: T) => void
}) {
  useI18n()
  return (
    <div role="radiogroup" aria-label={label} className="mx-2 flex rounded-lg bg-subtle p-0.5">
      {options.map(o => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            title={o.title}
            onClick={() => !selected && onChange(o.value)}
            className={cn(
              'flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-meta',
              selected
                ? 'border-line bg-surface font-medium text-fg shadow-sm'
                : 'border-transparent text-fg-muted hover:text-fg',
              o.disabled && 'cursor-default opacity-50 hover:text-fg-muted',
            )}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 输入框按钮上的文字：模型 + 额度来源 */
function triggerText(live: SourceMenuController, rate: number | null): { model: string; source: string } {
  const engineId = live.engine?.id ?? 'claude'
  if (live.source === 'platform')
    return {
      model: live.model ?? tr('session.ModelSourceMenu.message281'),
      source:
        rate === null
          ? tr('session.ModelSourceMenu.message279')
          : tr('session.ModelSourceMenu.message282', { p0: formatMultiplier(rate) }),
    }
  return {
    model: live.model ? selfModelLabel(engineId, live.model) : (live.engine?.name ?? 'Claude Code'),
    get source() {
      return tr('session.ModelSourceMenu.message280')
    },
  }
}

/** 祖先里会裁掉溢出内容的最近容器的顶部（窗口坐标）；没有时为 0 */
function clipTop(el: Element | null | undefined): number {
  let top = 0
  for (let e = el?.parentElement; e; e = e.parentElement) {
    const style = getComputedStyle(e)
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY + style.overflow))
      top = Math.max(top, e.getBoundingClientRect().top)
  }
  return top
}

export function ModelSourceMenu({
  live,
  open,
  onOpenChange,
  onRequestSource,
}: {
  live: SourceMenuController
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 改额度来源：已开始的会话由输入框先弹确认 */
  onRequestSource: (source: CreditSource) => void
}) {
  useI18n()
  const engineId: EngineId = live.engine?.id ?? 'claude'
  const platform = usePlatform(engineId)
  const catalog = useEngineCatalog(engineId)
  const account = useAccount()
  const [page, setPage] = useState<'main' | 'routes'>('main')
  const [showLoginHelp, setShowLoginHelp] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // 模型多于 8 个时显示搜索框（docs/ui/plan-search-panes-compact.md §1）
  const [modelQuery, setModelQuery] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const [menuHeight, setMenuHeight] = useState(420)
  // 菜单向上弹出，最高只到裁剪它的容器（窗格）顶部，不能按窗口顶部算：
  // 窗格在顶栏下面（分屏时可能更低），按窗口算时长菜单的上半截（引擎切换）会被窗格裁掉。
  useLayoutEffect(() => {
    if (!open) return
    const measure = (): void => {
      const el = trigger.current,
        top = el?.getBoundingClientRect().top ?? window.innerHeight
      setMenuHeight(Math.max(120, Math.min(window.innerHeight * 0.7, top - clipTop(el) - 32)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, live.source])

  useEffect(() => {
    if (!open) return
    setPage('main')
    setActionError(null)
    setModelQuery('')
    void refreshPlatform()
  }, [open])

  const engineConfig = useEngineState(s => s.config)
  const group = platform.groups.find(g => g.id === live.groupId)
  const text = triggerText(live, group ? group.rate_multiplier : null)
  const notReady = live.blocker !== null && live.blocker.kind !== 'balance'

  const run = (fn: () => Promise<void>): void => {
    setActionError(null)
    fn().catch((e: unknown) => setActionError((e as Error).message))
  }

  const allModels = platformModels(platform.groups)
  const models = visibleModels(allModels, platform.hiddenModels, [live.model, platform.model])
  const settings = useSettings()
  const manageModels = (): void => {
    onOpenChange(false)
    requestModelsScroll()
    settings.openSettings('models')
  }
  const routes = groupsForModel(platform.groups, live.model)

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={TRIGGER}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <EngineIcon engine={engineId} size={16} />
        <span className={cn('max-w-44 truncate', notReady && 'text-warn')}>{text.model}</span>
        <span className="shrink-0 text-meta text-fg-muted">· {text.source}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="text-fg-muted" />
      </button>
      <Popover open={open} onClose={() => onOpenChange(false)} className="right-0 bottom-full mb-2 w-80">
        {page === 'routes' ? (
          <RoutesPage
            live={live}
            routes={routes}
            balance={account.account?.balance ?? null}
            onBack={() => setPage('main')}
            run={run}
          />
        ) : (
          <div style={{ maxHeight: menuHeight }} className="flex flex-col overflow-y-auto">
            {/* 引擎 */}
            <MenuTitle>{tr('session.ModelSourceMenu.message283')}</MenuTitle>
            <MiniSegmented
              label={tr('session.ModelSourceMenu.message283')}
              value={engineId}
              onChange={id => live.selectEngine(id)}
              options={visibleEngines(live.engines, engineConfig, engineId).map(e => ({
                value: e.id,
                label: e.status === 'unsupported' ? tr('session.ModelSourceMenu.message284', { p0: e.name }) : e.name,
                icon: <EngineIcon engine={e.id} size={14} />,
                disabled: !live.canSwitchEngine || e.status === 'unsupported',
                title:
                  e.status === 'unsupported'
                    ? tr('session.ModelSourceMenu.message285')
                    : !live.canSwitchEngine
                      ? tr('session.ModelSourceMenu.message286')
                      : undefined,
              }))}
            />
            {!live.canSwitchEngine && (
              <p className="px-2 pt-1 text-label text-fg-faint">{tr('session.ModelSourceMenu.message287')}</p>
            )}

            {/* 额度来源 */}
            <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line-subtle px-2 pt-2.5 pb-1">
              <span className="text-label font-medium text-fg-faint">{tr('session.ModelSourceMenu.message288')}</span>
              {live.source === 'platform' && account.balanceText && (
                <span className="text-meta text-fg-muted tabular-nums">
                  {tr('account.AccountMenu.message36')} {account.balanceText}
                </span>
              )}
            </div>
            <MiniSegmented
              label={tr('session.ModelSourceMenu.message288')}
              value={live.source}
              onChange={s => {
                if (live.started) onOpenChange(false)
                onRequestSource(s)
              }}
              options={(['platform', 'self'] as const).map(s => ({
                value: s,
                label: SOURCE_LABEL[s],
                disabled: s === 'platform' && !live.platformAvailable,
                title:
                  s === 'platform' && !live.platformAvailable ? tr('session.ModelSourceMenu.message289') : undefined,
              }))}
            />
            {live.started && (
              <p className="px-2 pt-1 text-label text-fg-faint">{tr('session.ModelSourceMenu.message290')}</p>
            )}

            {live.source === 'platform' ? (
              <PlatformRoute live={live} onOpenRoutes={() => setPage('routes')} />
            ) : (
              <SelfStatus live={live} showHelp={showLoginHelp} onToggleHelp={() => setShowLoginHelp(v => !v)} />
            )}

            {/* 模型 */}
            <div className="mt-2 border-t border-line-subtle pt-1">
              <MenuTitle>{tr('session.ModelSourceMenu.message291')}</MenuTitle>
              {live.source === 'platform' ? (
                platform.email && allModels.length > 0 ? (
                  models.length === 0 ? (
                    <p className="px-2 pb-1.5 text-meta text-fg-faint">{tr('session.ModelSourceMenu.message292')}</p>
                  ) : (
                    <>
                      {models.length > MODEL_SEARCH_MIN && (
                        <input
                          value={modelQuery}
                          onChange={e => setModelQuery(e.target.value)}
                          placeholder={tr('session.ModelSourceMenu.message293')}
                          aria-label={tr('session.ModelSourceMenu.message293')}
                          spellCheck={false}
                          className="mx-2 mb-1 h-7 w-[calc(100%-1rem)] rounded-md border border-line bg-subtle px-2 font-mono text-meta text-fg outline-none placeholder:font-sans placeholder:text-fg-faint focus:border-line-strong focus:bg-surface"
                        />
                      )}
                      {matchModels(models, modelQuery).length === 0 && (
                        <p className="px-2 pb-1.5 text-meta text-fg-faint">
                          {tr('session.ModelSourceMenu.message294')}
                        </p>
                      )}
                      {matchModels(models, modelQuery).map(m => {
                        const gs = groupsForModel(platform.groups, m)
                        const min = gs[0]?.rate_multiplier ?? null
                        const multi = gs.some(g => g.rate_multiplier !== min)
                        return (
                          <MenuRow
                            key={m}
                            selected={m === live.model}
                            onClick={() => run(() => live.setModel(m))}
                            title={<span className="font-mono text-meta">{m}</span>}
                            hint={
                              min === null
                                ? undefined
                                : tr('session.ModelSourceMenu.message295', {
                                    p0: formatMultiplier(min),
                                    p1: multi ? ' 起' : '',
                                    p2: gs.length,
                                  })
                            }
                          />
                        )
                      })}
                    </>
                  )
                ) : (
                  <p className="px-2 pb-1.5 text-meta text-fg-faint">
                    {platform.email
                      ? tr('session.ModelSourceMenu.message297')
                      : tr('session.ModelSourceMenu.message298')}
                  </p>
                )
              ) : (
                [
                  ...SELF_MODELS[engineId],
                  ...(catalog?.models ?? []).map(m => ({ value: m.id, label: m.label, hint: m.id })),
                ].map(m => (
                  <MenuRow
                    key={m.value ?? 'default'}
                    selected={m.value === live.model}
                    onClick={() => run(() => live.setModel(m.value))}
                    title={m.label}
                    hint={m.hint}
                  />
                ))
              )}
              {/* 会话里的完整模型名（比如从平台切回来的 claude-opus-5-5）不在别名表里时也显示出来 */}
              {live.source === 'self' && live.model && !SELF_MODELS[engineId].some(m => m.value === live.model) && (
                <MenuRow
                  selected
                  title={<span className="font-mono text-meta">{live.model}</span>}
                  hint={tr('session.ModelSourceMenu.message299')}
                />
              )}
              {live.source === 'platform' && allModels.length > 0 && (
                <button
                  type="button"
                  onClick={manageModels}
                  className="mx-1 flex h-7 items-center rounded-md px-1.5 text-meta text-fg-muted hover:bg-hover hover:text-fg"
                >
                  {tr('session.ModelSourceMenu.message300')}{' '}
                  {platform.hiddenModels.length > 0 && (
                    <span className="ml-1 text-fg-faint">
                      {tr('session.ModelSourceMenu.message301')}{' '}
                      {allModels.filter(m => platform.hiddenModels.includes(m)).length}
                      {tr('session.ModelSourceMenu.message302')}{' '}
                    </span>
                  )}
                </button>
              )}
            </div>

            {actionError && (
              <p role="alert" className="mx-2 mt-1 rounded-md bg-subtle px-2 py-1.5 text-meta text-danger">
                {actionError}
              </p>
            )}

            <div className="mt-1 flex items-center gap-1 border-t border-line-subtle px-1 pt-1">
              {live.started && !live.isDefault && (
                <button
                  type="button"
                  onClick={() => live.saveAsDefault()}
                  title={tr('session.ModelSourceMenu.message303')}
                  className="flex h-7 items-center rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
                >
                  {tr('session.ModelSourceMenu.message304')}{' '}
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                disabled={platform.loading}
                onClick={() => {
                  void refreshPlatform()
                  live.redetect()
                }}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-meta text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
              >
                <RefreshCw size={12} className={cn(platform.loading && 'animate-spin')} />
                {platform.loading ? tr('session.ModelSourceMenu.message305') : tr('account.AccountMenu.message45')}
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  )
}

/** 平台时额度来源下面的一行：线路（点开子页）；没登录、读取中、出错时显示对应提示 */
function PlatformRoute({ live, onOpenRoutes }: { live: SourceMenuController; onOpenRoutes: () => void }) {
  useI18n()
  const platform = usePlatform(live.engine?.id ?? 'claude')
  const account = useAccount()
  const settings = useSettings()
  if (!platform.email) {
    return (
      <div className="mx-2 mt-2 flex items-center justify-between gap-2 rounded-md bg-subtle px-2.5 py-2 text-meta text-fg-muted">
        <span>{tr('session.ModelSourceMenu.message306')}</span>
        <button
          type="button"
          onClick={() => void account.login()}
          className="flex shrink-0 items-center gap-1 text-accent-fg hover:underline"
        >
          <LogIn size={12} />
          {tr('account.AccountMenu.message28')}{' '}
        </button>
      </div>
    )
  }
  if (!platform.loaded && platform.loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-meta text-fg-muted">
        <Spinner />
        {tr('session.ModelSourceMenu.message307')}{' '}
      </div>
    )
  }
  const group = platform.groups.find(g => g.id === live.groupId)
  if (!group) {
    const reason = noRouteReason(platform, account.account?.balance ?? null)
    return (
      <div className="mx-2 mt-2 rounded-md bg-subtle px-2.5 py-2 text-meta">
        <p role="alert" className="text-danger">
          {translateMessage(reason.message)}
        </p>
        <div className="mt-1.5 flex gap-3">
          {reason.balance && (
            <button
              type="button"
              onClick={() => settings.openSettings('account')}
              className="text-accent-fg hover:underline"
            >
              {tr('session.live.NoticeActions.message267')}{' '}
            </button>
          )}
          <button type="button" onClick={() => void refreshPlatform()} className="text-accent-fg hover:underline">
            {tr('session.ModelSourceMenu.message308')}{' '}
          </button>
        </div>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpenRoutes}
      className="mx-1 mt-1.5 flex items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-hover"
      aria-label={tr('session.ModelSourceMenu.message309')}
    >
      <span className="w-8 shrink-0 text-meta text-fg-muted">{tr('session.ModelSourceMenu.message310')}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-fg">{group.name}</span>
        <span className="block truncate text-meta text-fg-muted">{billingLabel(group)}</span>
      </span>
      <span
        className="shrink-0 text-ui text-fg-secondary tabular-nums"
        title={tr('session.ModelSourceMenu.message311')}
      >
        {formatMultiplier(group.rate_multiplier)}
      </span>
      <ChevronRight size={14} className="shrink-0 text-fg-muted" />
    </button>
  )
}

/** 自有时额度来源下面的一行：引擎本机登录状态。没登录用灰字 + 「怎么登录」，不用警告色（发送前提示条会提醒） */
function SelfStatus({
  live,
  showHelp,
  onToggleHelp,
}: {
  live: SourceMenuController
  showHelp: boolean
  onToggleHelp: () => void
}) {
  useI18n()
  const e = live.engine
  if (!e) return null
  if (e.status === 'ready') {
    return (
      <div className="flex items-center gap-1.5 px-2 pt-2 text-meta text-fg-muted">
        <Check size={13} className="text-success" />
        {e.name}
        {tr('session.ModelSourceMenu.message312')}{' '}
        {e.version ? tr('session.ModelSourceMenu.message313', { p0: e.version }) : ''}
      </div>
    )
  }
  return (
    <div className="px-2 pt-2 text-meta text-fg-muted">
      <div className="flex items-center justify-between gap-2">
        <span>
          {e.status === 'unauthenticated'
            ? tr('session.ModelSourceMenu.message314', { p0: e.name })
            : tr('session.ModelSourceMenu.message315', { p0: e.name })}
        </span>
        {e.message && (
          <button type="button" onClick={onToggleHelp} className="shrink-0 text-accent-fg hover:underline">
            {showHelp
              ? tr('session.ModelSourceMenu.message316')
              : e.status === 'unauthenticated'
                ? tr('session.ModelSourceMenu.message317')
                : tr('session.ModelSourceMenu.message318')}
          </button>
        )}
      </div>
      {showHelp && e.message && (
        <p className="selectable mt-1 rounded-md bg-subtle px-2 py-1.5 text-fg-secondary">
          {translateMessage(e.message)}
        </p>
      )}
    </div>
  )
}

/** 线路子页：只列包含当前模型的分组，按倍率从低到高 */
function RoutesPage({
  live,
  routes,
  balance,
  onBack,
  run,
}: {
  live: SourceMenuController
  routes: ReturnType<typeof groupsForModel>
  balance: number | null
  onBack: () => void
  run: (fn: () => Promise<void>) => void
}) {
  useI18n()
  return (
    <div className="flex max-h-[70vh] flex-col overflow-y-auto">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-meta text-fg-muted hover:bg-hover hover:text-fg"
      >
        <ChevronLeft size={14} />
        <span className="truncate">
          {tr('session.ModelSourceMenu.message310')}
          {live.model ? (
            <span className="font-mono">
              （{live.model}
              {tr('session.ModelSourceMenu.message319')}{' '}
            </span>
          ) : null}
        </span>
      </button>
      {routes.map(g => {
        const lowBalance = g.billing_source !== 'plan_only' && balance !== null && balance <= 0
        return (
          <MenuRow
            key={g.id}
            selected={g.id === live.groupId}
            onClick={() => {
              run(() => live.setGroup(g.id))
              onBack()
            }}
            title={
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="shrink-0 text-fg-secondary tabular-nums">{formatMultiplier(g.rate_multiplier)}</span>
              </span>
            }
            hint={
              <span className={cn(lowBalance && 'text-warn')}>
                {billingLabel(g)}
                {lowBalance ? tr('session.ModelSourceMenu.message320') : g.description ? ` · ${g.description}` : ''}
              </span>
            }
          />
        )
      })}
      <p className="border-t border-line-subtle px-2 pt-1.5 pb-1 text-label text-fg-faint">
        {tr('session.ModelSourceMenu.message321')}
      </p>
    </div>
  )
}

/** 输入框引擎菜单里的引擎：设置里隐藏的不显示，但当前会话正在用的照常显示（docs/ui/engine-settings-redesign.md §3.1） */
function visibleEngines<T extends { id: EngineId }>(engines: T[], config: EngineConfig | null, current: EngineId): T[] {
  return engines.filter(e => e.id === current || !config?.[e.id]?.hidden)
}
