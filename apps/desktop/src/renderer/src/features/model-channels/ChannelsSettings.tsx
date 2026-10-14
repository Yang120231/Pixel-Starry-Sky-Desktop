import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateMessage } from '../../i18n/core'
// 设置 › 模型通道（docs/ui/model-channels.md §2.1）：四张通道卡（状态 + 授权 / 登录按钮），自定义接口列在第四张里；
// 最下面「新对话用：接着上次 / 固定为」（§2.6）
import { useState, type ReactNode } from 'react'
import { LogIn } from 'lucide-react'
import { Button, EngineIcon, Segmented, Select, Spinner, cn } from '@/ui'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useAccount } from '@/features/account/useAccount'
import { usePlatformCatalog } from '@/features/account/platform'
import { useProviders } from '@/features/account/providers'
import { selfModelLabel, selfModelOptions } from '@/features/engine/labels'
import { useEngineCatalog } from '@/features/engine/catalog'
import { useEngineState } from '@/features/engine/store'
import { useMachines } from '@/features/machines/store'
import { useSettings } from '@/features/settings/SettingsProvider'
import { CustomApiSettings } from '@/features/settings/models/CustomApiSettings'
import {
  AUTH_ENGINE,
  buildChannelMenu,
  channelState,
  sameTarget,
  type AuthChannel,
  type ChannelChoice,
  type ChannelId,
} from './channelModel'
import {
  CHANNEL_DIGIT,
  CHANNEL_NUMBER,
  accountText,
  channelFix,
  channelLabel,
  channelShort,
  channelStateText,
  executorName,
} from './channelLabels'
import { useChannelPrefs } from './channelPrefs'
import { openAuthDialog } from './authDialogStore'
import { logoutEngine, useChannelEngines } from './loginStore'
import { currentNewTaskChoice, pinNewTask } from './newTaskDefault'

export function ChannelsSettings() {
  useI18n()
  return (
    <div data-setting-title={tr('modelChannels.title')} className="flex flex-col gap-3">
      <PlatformCard />
      <AuthCard channel="claude" />
      <AuthCard channel="chatgpt" />
      <Card channel="custom" status={tr('modelChannels.custom.desc')}>
        <div className="border-t border-line-subtle px-4 pb-3">
          <CustomApiSettings />
        </div>
      </Card>
      <NewTaskRow />
    </div>
  )
}

function Card({
  channel,
  status,
  sub,
  actions,
  children,
}: {
  channel: ChannelId
  status: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      data-channel-card={channel}
      data-setting-title={channelLabel(channel)}
      className="scroll-mt-4 rounded-lg border border-line"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-subtle text-meta font-semibold text-fg-secondary">
          {CHANNEL_DIGIT[channel]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-ui font-medium text-fg">{channelLabel(channel)}</span>
          <span className="block truncate text-meta text-fg-muted">{status}</span>
          {sub && <span className="block truncate text-meta text-fg-faint">{sub}</span>}
        </span>
        {actions && <span className="flex shrink-0 items-center gap-2">{actions}</span>}
      </div>
      {children}
    </div>
  )
}

function PlatformCard() {
  useI18n()
  const account = useAccount()
  const catalog = usePlatformCatalog()
  const settings = useSettings()
  if (!catalog.email)
    return (
      <Card
        channel="platform"
        status={tr('modelChannels.platform.desc')}
        actions={
          <Button variant="primary" icon={LogIn} onClick={() => void account.login()}>
            {tr('modelChannels.platform.signIn')}
          </Button>
        }
      />
    )
  return (
    <Card
      channel="platform"
      status={
        <>
          <span className="text-fg">{catalog.email}</span>
          {account.balanceText && (
            <span className="tabular-nums">
              {' '}
              {tr('settings.models.ModelsSection.balance', { p0: account.balanceText })}
            </span>
          )}
        </>
      }
      sub={tr('modelChannels.platform.engines')}
      actions={
        <>
          <Button onClick={() => settings.openSettings('account')}>{tr('modelChannels.platform.account')}</Button>
          <Button variant="ghost" onClick={() => void account.logout()}>
            {tr('modelChannels.platform.signOut')}
          </Button>
        </>
      }
    />
  )
}

function AuthCard({ channel }: { channel: AuthChannel }) {
  useI18n()
  const engine = AUTH_ENGINE[channel]
  const engines = useChannelEngines()
  const info = engines.find(e => e.id === engine)
  const machine = useMachines().currentId
  const settings = useSettings()
  const [confirm, setConfirm] = useState<'logout' | 'switch' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = channelState(channel, {
    platform: { email: null, loaded: false, loading: false, groups: [] },
    engines,
    providers: [],
  })
  const fix = channelFix(state)
  const desc = tr(`modelChannels.${channel}.desc`)
  // 远程机器（SSH / WSL）上的引擎要在那台机器上登录（§6）
  const remote = machine !== 'local'

  const logout = (then?: () => void): void => {
    setBusy(true)
    setError(null)
    void logoutEngine(engine).then(err => {
      setBusy(false)
      setConfirm(null)
      if (err) setError(err)
      else then?.()
    })
  }

  let status: ReactNode = desc
  let actions: ReactNode = null
  if (state.kind === 'loading') status = <Spinner />
  else if (state.kind === 'ready') {
    status = <span className="text-fg">{accountText(info?.account) || tr('modelChannels.auth.done')}</span>
    actions = remote ? null : (
      <>
        <Button onClick={() => setConfirm('switch')}>{tr('modelChannels.authCard.switch')}</Button>
        <Button variant="ghost" onClick={() => setConfirm('logout')}>
          {tr('modelChannels.authCard.logout')}
        </Button>
      </>
    )
  } else if (state.kind === 'auth') {
    actions = remote ? null : (
      <Button variant="primary" onClick={() => openAuthDialog(channel)}>
        {tr(`modelChannels.${channel}.signIn`)}
      </Button>
    )
  } else {
    status = <span className="text-warn">{channelStateText(channel, state)}</span>
    actions = fix && (
      <Button onClick={() => settings.openSettings('engines')}>{tr(`modelChannels.action.${fixKey(fix)}`)}</Button>
    )
  }

  return (
    <>
      <Card
        channel={channel}
        status={status}
        sub={
          remote ? (
            tr('modelChannels.authCard.remote')
          ) : error ? (
            <span className="text-danger">{translateMessage(error)}</span>
          ) : state.kind !== 'ready' && state.kind !== 'auth' ? (
            desc
          ) : null
        }
        actions={
          <>
            <EngineIcon engine={engine} size={14} className="opacity-70" />
            {actions}
          </>
        }
      />
      {confirm && (
        <ConfirmDialog
          title={tr(
            confirm === 'switch' ? 'modelChannels.authCard.switchTitle' : 'modelChannels.authCard.logoutTitle',
            {
              p0: channelLabel(channel),
            },
          )}
          description={tr(
            confirm === 'switch' ? 'modelChannels.authCard.switchDesc' : 'modelChannels.authCard.logoutDesc',
            { p0: info?.name ?? engine },
          )}
          confirmLabel={tr(confirm === 'switch' ? 'modelChannels.authCard.switch' : 'modelChannels.authCard.logout')}
          cancelLabel={tr('modelChannels.auth.cancel')}
          danger={confirm === 'logout'}
          busy={busy}
          error={error}
          onCancel={() => setConfirm(null)}
          onConfirm={() => logout(confirm === 'switch' ? () => openAuthDialog(channel) : undefined)}
        />
      )}
    </>
  )
}

const fixKey = (fix: NonNullable<ReturnType<typeof channelFix>>): 'install' | 'update' | 'view' =>
  fix === 'install' ? 'install' : fix === 'update' ? 'update' : 'view'

/** 「新对话用」：接着上次（默认）/ 固定为某个模型 */
function NewTaskRow() {
  useI18n()
  const prefs = useChannelPrefs()
  const defaultEngine = useEngineState(s => s.defaults?.engine) ?? 'claude'
  const catalog = usePlatformCatalog()
  const providers = useProviders()
  const engines = useChannelEngines()
  const claudeCatalog = useEngineCatalog('claude')
  const codexCatalog = useEngineCatalog('codex')
  const fixed = prefs.newTask.mode === 'fixed' ? prefs.newTask.choice : null
  const groups = buildChannelMenu({
    selection: fixed,
    locked: null,
    platform: catalog,
    selfModels: {
      claude: selfModelOptions('claude', claudeCatalog?.models),
      chatgpt: selfModelOptions('codex', codexCatalog?.models),
    },
    providers: providers.providers,
    engines,
    remembered: prefs.executors,
  })
  // 每个模型按它能跑的执行者各列一项（能换执行者的模型列两项）
  const options: Array<{ value: string; label: string; choice: ChannelChoice }> = []
  for (const g of groups)
    for (const row of g.rows)
      for (const engine of row.pick.options) {
        const choice: ChannelChoice = { ...row.target, engine }
        const provider = providers.providers.find(p => p.id === row.target.providerId)
        const model =
          g.channel === 'claude' || g.channel === 'chatgpt'
            ? selfModelLabel(engine, row.target.model)
            : (row.target.model ?? '')
        const where = g.channel === 'custom' ? (provider?.name ?? channelShort('custom')) : channelShort(g.channel)
        options.push({
          value: `${row.key}|${engine}`,
          label: `${CHANNEL_NUMBER[g.channel]} ${where} · ${model} · ${executorName(engine)}`,
          choice,
        })
      }
  const value = fixed ? options.find(o => sameTarget(o.choice, fixed) && o.choice.engine === fixed.engine) : undefined
  const missing = !!fixed && !value

  return (
    <div
      data-setting-title={tr('modelChannels.newTask.title')}
      className="mt-2 rounded-lg border border-line px-4 py-3"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-ui font-medium text-fg">{tr('modelChannels.newTask.title')}</div>
          <p className="mt-0.5 text-meta text-fg-muted">{tr('modelChannels.newTask.desc')}</p>
        </div>
        <Segmented
          label={tr('modelChannels.newTask.title')}
          value={prefs.newTask.mode}
          onChange={mode => pinNewTask(mode === 'last' ? null : (value?.choice ?? currentNewTaskChoice(defaultEngine)))}
          options={[
            { value: 'last', label: tr('modelChannels.continueLast') },
            { value: 'fixed', label: tr('modelChannels.newTask.fixed') },
          ]}
        />
      </div>
      {fixed && (
        <div className={cn('mt-3 flex items-center gap-2')}>
          <Select
            label={tr('modelChannels.newTask.fixed')}
            value={value?.value ?? ''}
            placeholder={tr('modelChannels.newTask.pick')}
            options={options.map(o => ({ value: o.value, label: o.label }))}
            onChange={v => {
              const o = options.find(x => x.value === v)
              if (o) pinNewTask(o.choice)
            }}
            className="min-w-0 flex-1"
          />
        </div>
      )}
      {missing && <p className="mt-2 text-meta text-warn">{tr('modelChannels.newTask.missing')}</p>}
    </div>
  )
}
