// 通道和执行者的显示文字（输入框菜单、设置页共用）
import { tr } from '../../i18n/core'
import { ENGINES, type EngineId } from '@pixelsky/protocol'
import { AUTH_ENGINE, type ChannelId, type ChannelState } from './channelModel'

export const CHANNEL_NUMBER: Record<ChannelId, string> = { platform: '①', claude: '②', chatgpt: '③', custom: '④' }

export const channelLabel = (c: ChannelId): string => tr(`modelChannels.channel.${c}`)
export const channelShort = (c: ChannelId): string => tr(`modelChannels.short.${c}`)

/** 执行者的名字：像素星空写成「像素星空 agent」，和通道「像素星空账号」分开 */
export const executorName = (e: EngineId): string =>
  e === 'pixel' ? tr('modelChannels.executor.pixel') : ENGINES[e].name

export const executorDesc = (e: EngineId): string => tr(`modelChannels.executor.desc.${e}`)

/** 已授权的账号：邮箱 · 套餐（max → Max）；都没有时为空 */
export function accountText(account: { email?: string; plan?: string; org?: string } | undefined): string {
  if (!account) return ''
  const plan = account.plan ? account.plan[0].toUpperCase() + account.plan.slice(1) : ''
  return [account.email, plan].filter(Boolean).join(' · ')
}

/** 通道不能用时的一句话；能用时为 null */
export function channelStateText(channel: ChannelId, state: ChannelState): string | null {
  const engine = channel === 'claude' || channel === 'chatgpt' ? ENGINES[AUTH_ENGINE[channel]].name : ''
  switch (state.kind) {
    case 'ready':
      return null
    case 'loading':
      return tr('modelChannels.state.loading')
    case 'signin':
      return tr('modelChannels.state.signin')
    case 'no-route':
      return tr('modelChannels.state.noRoute')
    case 'auth':
      return tr('modelChannels.state.auth')
    case 'missing':
      return tr('modelChannels.state.missing', { p0: engine })
    case 'outdated':
      return tr('modelChannels.state.outdated', { p0: engine })
    case 'error':
      return tr('modelChannels.state.error', { p0: engine })
    case 'empty':
      return tr('modelChannels.state.empty')
  }
}

/** 通道不能用时右边的按钮 */
export type ChannelFix = 'signin' | 'retry' | 'auth' | 'install' | 'update' | 'view' | 'add-endpoint'

export function channelFix(state: ChannelState): ChannelFix | null {
  switch (state.kind) {
    case 'signin':
      return 'signin'
    case 'no-route':
      return 'retry'
    case 'auth':
      return 'auth'
    case 'missing':
      return 'install'
    case 'outdated':
      return 'update'
    case 'error':
      return 'view'
    case 'empty':
      return 'add-endpoint'
    default:
      return null
  }
}

export function channelFixLabel(fix: ChannelFix): string {
  switch (fix) {
    case 'signin':
      return tr('modelChannels.action.signIn')
    case 'retry':
      return tr('modelChannels.action.retry')
    case 'auth':
      return tr('modelChannels.action.auth')
    case 'install':
      return tr('modelChannels.action.install')
    case 'update':
      return tr('modelChannels.action.update')
    case 'view':
      return tr('modelChannels.action.view')
    case 'add-endpoint':
      return tr('modelChannels.action.addEndpoint')
  }
}
