import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr } from '../../i18n/core'
// 输入框的模型菜单（docs/ui/model-channels.md §2.3、§2.5）：按四条通道分组列模型，每一行右边写谁来执行，
// 两个执行者都能跑的模型可以点开换。平台模型的线路在子页里，按倍率从低到高排（docs/ui/source-switch.md §3.2）。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import type { EngineId } from '@pixelsky/protocol'
import { EngineIcon, Popover, Spinner, cn } from '@/ui'
import { useAccount } from '@/features/account/useAccount'
import { useProviders } from '@/features/account/providers'
import {
  billingLabel,
  formatMultiplier,
  groupsForModel,
  noRouteReason,
  refreshPlatform,
  usePlatform,
  usePlatformCatalog,
  MODEL_SEARCH_MIN,
  matchModels,
} from '@/features/account/platform'
import { selfModelLabel, selfModelOptions, type SourceMenuController } from '@/features/engine'
import { useSettings } from '@/features/settings/SettingsProvider'
import { useEngineCatalog } from '@/features/engine/catalog'
import { requestModelsScroll } from '@/features/settings/models/scroll'
import {
  AUTH_ENGINE,
  buildChannelMenu,
  isAuthChannel,
  sameTarget,
  type ChannelChoice,
  type ChannelGroupView,
  type ChannelId,
  type ChannelRow,
  type ModelTarget,
} from '@/features/model-channels/channelModel'
import {
  CHANNEL_DIGIT,
  maskEmail,
  planLabel,
  channelFix,
  channelFixLabel,
  channelLabel,
  channelShort,
  channelStateText,
  executorDesc,
  executorName,
} from '@/features/model-channels/channelLabels'
import { rememberExecutor, useChannelPrefs } from '@/features/model-channels/channelPrefs'
import { pinNewTask } from '@/features/model-channels/newTaskDefault'
import { openAuthDialog } from '@/features/model-channels/authDialogStore'
import { useChannelEngines } from '@/features/model-channels/loginStore'
import { MenuRow, TRIGGER } from './ComposerMenus'

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

type Page = { kind: 'main' } | { kind: 'routes' } | { kind: 'executor'; key: string }

export function ModelSourceMenu({
  live,
  newTask,
  open,
  onOpenChange,
  onRequestChoice,
}: {
  live: SourceMenuController
  /** 欢迎页的输入框：没自己选过时写「接着上次」 */
  newTask?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 已开始的对话换到别的通道：由输入框先弹确认（会重启引擎并接上原对话） */
  onRequestChoice: (choice: ChannelChoice) => void
}) {
  useI18n()
  const engineId: EngineId = live.engine?.id ?? 'claude'
  const platform = usePlatform(engineId)
  const catalog = usePlatformCatalog()
  const ownCatalog = useEngineCatalog(engineId)
  const claudeCatalog = useEngineCatalog('claude')
  const codexCatalog = useEngineCatalog('codex')
  const engines = useChannelEngines()
  const providers = useProviders()
  const prefs = useChannelPrefs()
  const account = useAccount()
  const settings = useSettings()
  const [page, setPage] = useState<Page>({ kind: 'main' })
  const [actionError, setActionError] = useState<string | null>(null)
  // 平台模型多于 8 个时显示搜索框（docs/ui/plan-search-panes-compact.md §1）
  const [modelQuery, setModelQuery] = useState('')
  /** 这个输入框里自己选过模型：不再显示「接着上次」 */
  const [picked, setPicked] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [menuHeight, setMenuHeight] = useState(420)
  // 菜单向上弹出，最高只到裁剪它的容器（窗格）顶部，不能按窗口顶部算：
  // 窗格在顶栏下面（分屏时可能更低），按窗口算时长菜单的上半截会被窗格裁掉。
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
  }, [open])

  useEffect(() => {
    if (!open) return
    setPage({ kind: 'main' })
    setActionError(null)
    setModelQuery('')
    void refreshPlatform()
  }, [open])

  const selection: ModelTarget = { channel: live.channel, model: live.model, providerId: live.providerId }
  const locked = live.canSwitchEngine ? null : engineId
  const groups = buildChannelMenu({
    selection,
    locked,
    platform: catalog,
    selfModels: {
      claude: selfModelOptions('claude', claudeCatalog?.models),
      chatgpt: selfModelOptions('codex', codexCatalog?.models),
    },
    providers: providers.providers,
    engines,
    remembered: prefs.executors,
  })
  const route = platform.groups.find(g => g.id === live.groupId)
  const endpoint = providers.providers.find(p => p.id === live.providerId)
  const notReady = live.blocker !== null && live.blocker.kind !== 'balance'

  const run = (fn: () => Promise<void>): void => {
    setActionError(null)
    fn().catch((e: unknown) => setActionError((e as Error).message))
  }
  const manageModels = (): void => {
    onOpenChange(false)
    requestModelsScroll()
    settings.openSettings('models')
  }

  /** 选了一个模型；keepOpen：自定义接口那一行（下面还要选模型） */
  const choose = (target: ModelTarget, engine: EngineId | null, keepOpen = false): void => {
    if (!engine) return
    setPicked(true)
    const choice: ChannelChoice = { ...target, engine }
    if (live.started && target.channel !== live.channel) {
      onOpenChange(false)
      onRequestChoice(choice)
      return
    }
    // 成功了才收起菜单：出错时原因写在菜单里
    run(async () => {
      await live.applyChoice(choice)
      if (!keepOpen) onOpenChange(false)
    })
  }

  const modelText =
    live.channel === 'claude' || live.channel === 'chatgpt'
      ? selfModelLabel(engineId, live.model, ownCatalog?.models)
      : (live.model ?? tr('session.ModelSourceMenu.chooseModel'))
  const channelText =
    live.channel === 'custom'
      ? (endpoint?.name ?? channelShort('custom'))
      : live.channel === 'platform' && route
        ? `${channelShort('platform')} ${formatMultiplier(route.rate_multiplier)}`
        : channelShort(live.channel)
  const fixed = prefs.newTask.mode === 'fixed' ? prefs.newTask.choice : null
  const current: ChannelChoice = { ...selection, engine: engineId }
  const canPin = !!fixed && !(sameTarget(fixed, current) && fixed.engine === engineId)
  const executorRow = page.kind === 'executor' ? groups.flatMap(g => g.rows).find(r => r.key === page.key) : undefined

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={TRIGGER}
        title={`${modelText} · ${channelText} · ${executorName(engineId)}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <EngineIcon engine={engineId} size={16} />
        <span data-model-name className={cn('max-w-44 truncate', notReady && 'text-warn')}>
          {modelText}
        </span>
        <span data-model-source className="shrink-0 text-meta text-fg-muted">
          · {channelText}
        </span>
        {newTask && !live.started && !picked && prefs.newTask.mode === 'last' && (
          <span
            data-continue-last
            title={tr('modelChannels.continueLastTitle')}
            className="shrink-0 rounded-full bg-accent/10 px-1.5 text-label leading-[18px] text-accent-fg"
          >
            {tr('modelChannels.continueLast')}
          </span>
        )}
        <ChevronDown size={14} strokeWidth={1.5} className="text-fg-muted" />
      </button>
      <Popover open={open} onClose={() => onOpenChange(false)} side="top" align="end" offset={8} className="w-96">
        {page.kind === 'routes' ? (
          <RoutesPage
            live={live}
            routes={groupsForModel(platform.groups, live.model)}
            balance={account.account?.balance ?? null}
            onBack={() => setPage({ kind: 'main' })}
            run={run}
          />
        ) : page.kind === 'executor' && executorRow ? (
          <ExecutorPage
            row={executorRow}
            engines={engines}
            onBack={() => setPage({ kind: 'main' })}
            onPick={e => {
              rememberExecutor(executorRow.target, e)
              choose(executorRow.target, e)
            }}
          />
        ) : (
          <div style={{ maxHeight: menuHeight }} className="flex flex-col overflow-y-auto">
            {locked && (
              <p className="px-2 pt-1 pb-0.5 text-label text-fg-faint">
                {tr('modelChannels.lockedNote', { p0: executorName(locked) })}
              </p>
            )}
            {groups.map((g, i) => (
              <ChannelSection
                key={g.channel}
                group={g}
                first={i === 0}
                live={live}
                query={modelQuery}
                onQuery={setModelQuery}
                hiddenCount={
                  g.channel === 'platform'
                    ? catalog.hiddenModels.filter(m => catalog.groups.some(x => x.models.includes(m))).length
                    : 0
                }
                ownModels={ownCatalog?.models}
                right={
                  g.channel === 'platform' ? (
                    catalog.email &&
                    account.balanceText && (
                      <span className="text-meta text-fg-muted tabular-nums">
                        {tr('account.AccountMenu.balance')} {account.balanceText}
                      </span>
                    )
                  ) : isAuthChannel(g.channel) && g.state.kind === 'ready' ? (
                    <AccountTag account={engines.find(e => e.id === AUTH_ENGINE[g.channel as 'claude'])?.account} />
                  ) : null
                }
                stateText={
                  g.channel === 'platform' && g.state.kind === 'no-route'
                    ? translateMessage(noRouteReason(catalog, account.account?.balance ?? null).message)
                    : channelStateText(g.channel, g.state)
                }
                onFix={() => {
                  const fix = channelFix(g.state)
                  if (fix === 'signin') void account.login()
                  else if (fix === 'retry') void refreshPlatform()
                  else if (fix === 'auth' && isAuthChannel(g.channel)) {
                    onOpenChange(false)
                    openAuthDialog(g.channel)
                  } else if (fix === 'add-endpoint') manageModels()
                  else if (fix) {
                    onOpenChange(false)
                    settings.openSettings('engines')
                  }
                }}
                onChoose={choose}
                onSwitch={row => setPage({ kind: 'executor', key: row.key })}
                onRoutes={() => setPage({ kind: 'routes' })}
                onManage={manageModels}
              />
            ))}

            {actionError && (
              <p role="alert" className="mx-2 mt-1 rounded-md bg-subtle px-2 py-1.5 text-meta text-danger">
                {translateMessage(actionError)}
              </p>
            )}

            <div className="mt-1 flex items-center gap-1 border-t border-line-subtle px-1 pt-1">
              {canPin && (
                <button
                  type="button"
                  onClick={() => {
                    pinNewTask(current)
                    live.saveAsDefault()
                  }}
                  title={tr('session.ModelSourceMenu.useThisConversationsCredit')}
                  className="flex h-7 items-center rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
                >
                  {tr('session.ModelSourceMenu.setAsDefault')}
                </button>
              )}
              <button
                type="button"
                onClick={manageModels}
                className="flex h-7 items-center rounded-md px-2 text-meta text-fg-muted hover:bg-hover hover:text-fg"
              >
                {tr('modelChannels.menu.settings')}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={catalog.loading}
                onClick={() => {
                  void refreshPlatform()
                  live.redetect()
                }}
                className="flex h-7 items-center gap-1.5 rounded-md px-2 text-meta text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
              >
                <RefreshCw size={12} className={cn(catalog.loading && 'animate-spin')} />
                {catalog.loading ? tr('session.ModelSourceMenu.refreshing') : tr('account.AccountMenu.refresh')}
              </button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  )
}

/** 一个通道：标题行（右边余额 / 账号）+ 模型；不能用时一行状态和按钮 */
function ChannelSection({
  group,
  first,
  live,
  query,
  onQuery,
  hiddenCount,
  ownModels,
  right,
  stateText,
  onFix,
  onChoose,
  onSwitch,
  onRoutes,
  onManage,
}: {
  group: ChannelGroupView
  first: boolean
  live: SourceMenuController
  query: string
  onQuery: (q: string) => void
  hiddenCount: number
  ownModels: Parameters<typeof selfModelLabel>[2]
  right: ReactNode
  stateText: string | null
  onFix: () => void
  onChoose: (target: ModelTarget, engine: EngineId | null, keepOpen?: boolean) => void
  onSwitch: (row: ChannelRow) => void
  onRoutes: () => void
  onManage: () => void
}) {
  useI18n()
  const providers = useProviders()
  const catalog = usePlatformCatalog()
  const claudeCatalog = useEngineCatalog('claude')
  const codexCatalog = useEngineCatalog('codex')
  const c = group.channel
  const fix = channelFix(group.state)
  const rows = c === 'platform' && group.rows.length > MODEL_SEARCH_MIN ? filterRows(group.rows, query) : group.rows
  const selfOptions =
    c === 'claude'
      ? selfModelOptions('claude', claudeCatalog?.models)
      : c === 'chatgpt'
        ? selfModelOptions('codex', codexCatalog?.models)
        : []
  // 会话里的完整模型名（比如从平台切回来的 claude-opus-5-5）不在别名表里时也显示出来
  const extraSelf =
    isAuthChannel(c) && live.channel === c && live.model && !group.rows.some(r => r.target.model === live.model)
      ? live.model
      : null
  const fixedEngine = isAuthChannel(c) && group.state.kind === 'ready' ? AUTH_ENGINE[c] : null
  const deleted =
    c === 'custom' &&
    live.channel === 'custom' &&
    !!live.providerId &&
    !providers.providers.some(p => p.id === live.providerId)

  return (
    <div className={cn(!first && 'mt-1 border-t border-line-subtle')}>
      <div data-channel-group={c} className="flex min-h-7 items-center justify-between gap-3 px-2 pt-2 pb-0.5">
        <span className="flex min-w-0 items-center gap-1.5 text-label font-medium text-fg-secondary">
          <span className="flex size-4 shrink-0 items-center justify-center rounded bg-subtle text-[10px] leading-none font-semibold text-fg-muted tabular-nums">
            {CHANNEL_DIGIT[c]}
          </span>
          <span className="truncate">{channelLabel(c)}</span>
          {/* 授权通道只能交给官方工具：执行者在标题里写一次，每行不再重复 */}
          {fixedEngine && (
            <span className="flex shrink-0 items-center gap-1 font-normal text-fg-faint">
              <span aria-hidden>·</span>
              <EngineIcon engine={fixedEngine} size={11} />
              {executorName(fixedEngine)}
            </span>
          )}
        </span>
        {right}
      </div>
      {stateText && (
        <div className="mx-1 flex items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-meta text-fg-faint">
          {group.state.kind === 'loading' && <Spinner />}
          <span className="min-w-0 flex-1">{stateText}</span>
          {fix && (
            <button type="button" onClick={onFix} className="flex shrink-0 items-center text-accent-fg hover:underline">
              {channelFixLabel(fix)}
              <ChevronRight size={12} />
            </button>
          )}
        </div>
      )}
      {deleted && <p className="px-2 pb-1 text-meta text-warn">{tr('customApi.endpointDeleted')}</p>}
      {c === 'platform' && group.rows.length > MODEL_SEARCH_MIN && (
        <input
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder={tr('session.ModelSourceMenu.searchModels')}
          aria-label={tr('session.ModelSourceMenu.searchModels')}
          spellCheck={false}
          className="mx-2 my-1 h-7 w-[calc(100%-1rem)] rounded-md border border-line bg-subtle px-2 font-mono text-meta text-fg outline-none placeholder:font-sans placeholder:text-fg-faint focus:border-line-strong focus:bg-surface"
        />
      )}
      {c === 'platform' && group.rows.length > MODEL_SEARCH_MIN && rows.length === 0 && (
        <p className="px-2 pb-1.5 text-meta text-fg-faint">{tr('session.ModelSourceMenu.noMatchingModels')}</p>
      )}
      {c === 'platform' && group.state.kind === 'ready' && group.rows.length === 0 && (
        <p className="px-2 pb-1.5 text-meta text-fg-faint">{tr('session.ModelSourceMenu.allModelsAreHidden')}</p>
      )}
      <div className="px-1">
        {rows.map(row => {
          const hint = rowHint(row, c, {
            catalog,
            self: selfOptions,
            provider: providers.providers.find(p => p.id === row.target.providerId),
          })
          const provider = c === 'custom' ? providers.providers.find(p => p.id === row.target.providerId) : undefined
          const expand = !!provider && row.selected && provider.models.length > 1
          return (
            <div key={row.key}>
              <ChannelModelRow
                title={
                  c === 'platform' ? (
                    <span className="font-mono text-meta">{row.target.model}</span>
                  ) : c === 'custom' ? (
                    <span>
                      {provider?.name}
                      {row.target.model && (
                        <span className="font-mono text-meta text-fg-muted"> · {row.target.model}</span>
                      )}
                    </span>
                  ) : (
                    (selfOptions.find(m => m.value === row.target.model)?.label ??
                    selfModelLabel(AUTH_ENGINE[c as 'claude'], row.target.model, ownModels))
                  )
                }
                hint={hint}
                selected={row.selected && !expand}
                disabled={row.disabled !== null}
                onClick={() => onChoose(row.target, row.pick.engine, !!provider && provider.models.length > 1)}
                chip={fixedEngine ? undefined : <ExecutorChip row={row} onSwitch={() => onSwitch(row)} />}
              />
              {/* 选中的平台模型：下面一行是线路（点开子页） */}
              {c === 'platform' && row.selected && live.channel === 'platform' && (
                <PlatformRoute live={live} onOpenRoutes={onRoutes} />
              )}
              {/* 选中的自定义接口有多个模型：展开选模型 */}
              {expand &&
                provider!.models.map(m => (
                  <ChannelModelRow
                    key={m.id}
                    indent
                    title={<span className="font-mono text-meta">{m.id}</span>}
                    selected={m.id === live.model}
                    onClick={() => onChoose({ ...row.target, model: m.id }, row.pick.engine)}
                  />
                ))}
            </div>
          )
        })}
        {extraSelf && (
          <ChannelModelRow
            selected
            title={<span className="font-mono text-meta">{extraSelf}</span>}
            hint={tr('session.ModelSourceMenu.modelUsedByThis')}
          />
        )}
      </div>
      {c === 'platform' && group.state.kind === 'ready' && (
        <button
          type="button"
          onClick={onManage}
          className="mx-1 flex h-7 items-center rounded-md pr-1.5 pl-8 text-meta text-fg-muted hover:bg-hover hover:text-fg"
        >
          {tr('session.ModelSourceMenu.manageModels')}
          {hiddenCount > 0 && (
            <span className="ml-1 text-fg-faint">
              {tr('session.ModelSourceMenu.hidden')} {hiddenCount}
              {tr('session.ModelSourceMenu.text')}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

function filterRows(rows: ChannelRow[], query: string): ChannelRow[] {
  const keep = new Set(
    matchModels(
      rows.map(r => r.target.model ?? ''),
      query,
    ),
  )
  return rows.filter(r => keep.has(r.target.model ?? ''))
}

/** 行下面的小字：不能用的原因 > 自动换了执行者 > 线路 / 说明 / 接口状态 */
function rowHint(
  row: ChannelRow,
  c: ChannelId,
  ctx: {
    catalog: ReturnType<typeof usePlatformCatalog>
    self: Array<{ value: string | null; hint: string }>
    provider: { keyHint: string | null; models: unknown[] } | undefined
  },
): ReactNode {
  const first = row.candidates[0]
  if (row.disabled === 'locked' && first) return tr('modelChannels.row.locked', { p0: executorName(first) })
  if (row.disabled === 'no-executor' && first) return tr('modelChannels.row.noExecutor', { p0: executorName(first) })
  if (row.pick.fallbackFrom && row.pick.engine)
    return tr('modelChannels.executor.fallbackMissing', {
      p0: executorName(row.pick.fallbackFrom),
      p1: executorName(row.pick.engine),
    })
  if (c === 'platform') {
    const gs = groupsForModel(ctx.catalog.groups, row.target.model)
    const min = gs[0]?.rate_multiplier ?? null
    if (min === null) return undefined
    return tr('session.ModelSourceMenu.routes', {
      p0: formatMultiplier(min),
      p1: gs.some(g => g.rate_multiplier !== min) ? ' 起' : '',
      p2: gs.length,
    })
  }
  if (c === 'custom') return ctx.provider && !ctx.provider.keyHint ? tr('customApi.noKey') : undefined
  return ctx.self.find(m => m.value === row.target.model)?.hint
}

/** 授权通道标题右边：打码的邮箱 + 套餐小标签，悬停看完整邮箱 */
function AccountTag({ account }: { account: { email?: string; plan?: string } | undefined }) {
  if (!account?.email && !account?.plan) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-fg-muted" title={account.email}>
      {account.email && <span className="truncate">{maskEmail(account.email)}</span>}
      {account.plan && (
        <span className="shrink-0 rounded bg-subtle px-1.5 text-label leading-[18px] font-medium text-fg-secondary">
          {planLabel(account.plan)}
        </span>
      )}
    </span>
  )
}

/** 菜单里的一行：左边点了选模型，右边是执行者（能换时是按钮） */
function ChannelModelRow({
  title,
  hint,
  selected,
  disabled,
  indent,
  onClick,
  chip,
}: {
  title: ReactNode
  hint?: ReactNode
  selected?: boolean
  disabled?: boolean
  indent?: boolean
  onClick?: () => void
  chip?: ReactNode
}) {
  return (
    <div className={cn('flex items-center rounded-md', selected && 'bg-selected')}>
      <button
        type="button"
        data-menu-item
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
          selected && 'hover:bg-selected',
          indent && 'pl-6',
        )}
      >
        {/* 勾放最左边一列：每行的模型名对齐，右边留给执行者 */}
        <span className="flex w-4 shrink-0 justify-center self-center">
          {selected && <Check size={14} strokeWidth={2.25} className="text-accent-fg" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-fg">{title}</span>
          {hint && <span className="block truncate text-meta text-fg-muted">{hint}</span>}
        </span>
      </button>
      {chip}
    </div>
  )
}

/** 行右边的执行者：能换时是按钮（点开「谁来执行」），否则只是写明 */
function ExecutorChip({ row, onSwitch }: { row: ChannelRow; onSwitch: () => void }) {
  useI18n()
  const e = row.pick.engine
  if (!e || row.disabled) return null
  const content = (
    <>
      <EngineIcon engine={e} size={12} />
      <span className="truncate">{executorName(e)}</span>
    </>
  )
  if (row.pick.options.length < 2)
    return (
      <span
        data-executor={e}
        className="mr-1 flex h-6 max-w-32 shrink-0 items-center gap-1 px-1.5 text-label text-fg-faint"
      >
        {content}
      </span>
    )
  return (
    <button
      type="button"
      data-executor={e}
      onClick={onSwitch}
      title={tr('modelChannels.executor.switch')}
      aria-label={`${tr('modelChannels.executor.title')}: ${executorName(e)}`}
      className="mr-1 flex h-6 max-w-32 shrink-0 items-center gap-1 rounded-md border border-line-subtle px-1.5 text-label text-fg-muted hover:border-line hover:bg-surface hover:text-fg"
    >
      {content}
      <ChevronDown size={11} className="shrink-0" />
    </button>
  )
}

/** 「谁来执行」子页：列出能跑这个模型的执行者，默认的标「推荐」 */
function ExecutorPage({
  row,
  engines,
  onBack,
  onPick,
}: {
  row: ChannelRow
  engines: Array<{ id: EngineId; status: string }>
  onBack: () => void
  onPick: (e: EngineId) => void
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
          {tr('modelChannels.executor.title')}
          {row.target.model && <span className="ml-1.5 font-mono">{row.target.model}</span>}
        </span>
      </button>
      {row.candidates.map((e, i) => {
        const ok = row.pick.options.includes(e)
        const status = engines.find(x => x.id === e)?.status
        return (
          <MenuRow
            key={e}
            icon={<EngineIcon engine={e} size={16} />}
            selected={e === row.pick.engine}
            disabled={!ok}
            onClick={() => onPick(e)}
            title={
              <span className="flex items-center gap-1.5">
                {executorName(e)}
                {i === 0 && (
                  <span className="rounded-full border border-accent/40 px-1.5 text-label leading-4 text-accent-fg">
                    {tr('modelChannels.executor.recommended')}
                  </span>
                )}
              </span>
            }
            hint={
              ok
                ? executorDesc(e)
                : status === 'missing'
                  ? tr('modelChannels.executor.notInstalled')
                  : tr('modelChannels.executor.unavailable')
            }
          />
        )
      })}
      <p className="mt-1 border-t border-line-subtle px-2 pt-1.5 pb-1 text-label text-fg-faint">
        {tr('modelChannels.executor.lockedNote')}
      </p>
    </div>
  )
}

/** 选中的平台模型下面一行：线路（点开子页）；读取中、出错时显示对应提示 */
function PlatformRoute({ live, onOpenRoutes }: { live: SourceMenuController; onOpenRoutes: () => void }) {
  useI18n()
  const platform = usePlatform(live.engine?.id ?? 'claude')
  if (!platform.email) return null
  if (!platform.loaded && platform.loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 pl-8 text-meta text-fg-muted">
        <Spinner />
        {tr('session.ModelSourceMenu.loadingRoutes')}
      </div>
    )
  }
  const group = platform.groups.find(g => g.id === live.groupId)
  if (!group) return null
  return (
    <button
      type="button"
      onClick={onOpenRoutes}
      className="flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-8 text-left hover:bg-hover"
      aria-label={tr('session.ModelSourceMenu.chooseRoute')}
    >
      <span className="shrink-0 text-meta text-fg-muted">{tr('session.ModelSourceMenu.route')}</span>
      <span className="min-w-0 flex-1 truncate text-meta text-fg">
        {group.name}
        <span className="text-fg-muted"> · {billingLabel(group)}</span>
      </span>
      <span
        className="shrink-0 text-meta text-fg-secondary tabular-nums"
        title={tr('session.ModelSourceMenu.thisAccountsBillingMultiplier')}
      >
        {formatMultiplier(group.rate_multiplier)}
      </span>
      <ChevronRight size={13} className="shrink-0 text-fg-muted" />
    </button>
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
          {tr('session.ModelSourceMenu.route')}
          {live.model ? (
            <span className="font-mono">
              （{live.model}
              {tr('session.ModelSourceMenu.available')}{' '}
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
                {lowBalance
                  ? tr('session.ModelSourceMenu.insufficientBalance')
                  : g.description
                    ? ` · ${g.description}`
                    : ''}
              </span>
            }
          />
        )
      })}
      <p className="border-t border-line-subtle px-2 pt-1.5 pb-1 text-label text-fg-faint">
        {tr('session.ModelSourceMenu.onlyRoutesSupportingThis')}
      </p>
    </div>
  )
}
