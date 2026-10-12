// 协作频道 Phase B（docs/ui/channels-phase-b.md §10–§11）：把 core/channels 的 Channels 接到 IPC。
// 引擎调用走 ctx.engineCall（和窗口同一层路由，含 SSH 机器）；会话事件和机器变化从 EventBus.taps 收。
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { app } from 'electron'
import { describeError, logger } from '@pixelsky/engine'
import type { HostEvent } from '@pixelsky/protocol'
import * as ipc from '../ipc/guard'
import type { AppContext } from '../app/context'
import { windowLocale } from '../app/ui-language'
import { machineOf } from '../machines/identity'
import { ChannelStore } from '../core/channels/store'
import { Channels, type MachineLite } from '../core/channels/service'
import type { AgentInput, ChannelInput, ChannelTaskAction, PostInput } from '../../shared/types/channels'

const str = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value) throw new Error(`${what}不正确`)
  return value
}
const ACTIONS = new Set<ChannelTaskAction>(['cancel', 'stop', 'retry'])

function selfName(): string {
  try {
    return userInfo().username || 'Me'
  } catch {
    return 'Me'
  }
}

export async function initChannels(ctx: AppContext): Promise<void> {
  const log = logger('channels')
  const store = new ChannelStore(join(app.getPath('userData'), 'channels'))
  await store.init()
  const machines = (): MachineLite[] =>
    ctx.machines
      ? ctx.machines.state().machines.map(m => ({
          id: m.id,
          name: m.name,
          connected: m.status === 'local' || m.status === 'connected',
        }))
      : [{ id: 'local', name: '', connected: true }]
  const channels = new Channels({
    store,
    call: (channel, args) => {
      if (!ctx.engineCall) return Promise.reject(new Error('项目尚未加载'))
      return ctx.engineCall(channel, args, 'channels')
    },
    emit: (channel, value) => ctx.events.broadcast(channel, value),
    machines,
    projects: () => ctx.machines?.projects() ?? ctx.engine?.projects() ?? [],
    sessions: () => ctx.machines?.sessions() ?? ctx.engine?.sessions() ?? [],
    machineOf,
    selfName,
    locale: () => windowLocale(),
    log: (message, error) => log.warn(message, error ? { error: describeError(error) } : undefined),
  })
  ctx.events.taps.add((channel, args) => {
    try {
      if (channel === 'engine:event') channels.hostEvent(args[0] as HostEvent)
      else if (channel === 'machines:changed') channels.machinesChanged()
    } catch (error) {
      log.warn('频道处理事件失败', { error: describeError(error) })
    }
  })
  ctx.lifecycle.onShutdown(() => channels.dispose())

  ipc.handle('channels:state', () => channels.state())
  ipc.handle('channels:messages', (_e, id, before) =>
    channels.messages(str(id, '频道'), typeof before === 'number' ? before : null),
  )
  ipc.handle('channels:create', (_e, input) => channels.create(input as ChannelInput))
  ipc.handle('channels:update', (_e, id, patch) =>
    channels.update(str(id, '频道'), (patch ?? {}) as Parameters<Channels['update']>[1]),
  )
  ipc.handle('channels:delete', (_e, id) => channels.delete(str(id, '频道')))
  ipc.handle('channels:post', (_e, id, input) => channels.post(str(id, '频道'), input as PostInput))
  ipc.handle('channels:markRead', (_e, id) => channels.markRead(str(id, '频道')))
  ipc.handle('channels:saveMember', (_e, channelId, input) =>
    channels.saveMember(typeof channelId === 'string' && channelId ? channelId : null, input as AgentInput),
  )
  ipc.handle('channels:addMember', (_e, channelId, memberId) =>
    channels.addMember(str(channelId, '频道'), str(memberId, '成员')),
  )
  ipc.handle('channels:removeMember', (_e, channelId, memberId) =>
    channels.removeMember(str(channelId, '频道'), str(memberId, '成员')),
  )
  ipc.handle('channels:deleteMember', (_e, memberId) => channels.deleteMember(str(memberId, '成员')))
  ipc.handle('channels:task', (_e, taskId, action) => {
    if (!ACTIONS.has(action as ChannelTaskAction)) throw new Error('不支持的操作')
    return channels.taskAction(str(taskId, '任务'), action as ChannelTaskAction)
  })

  // 启动时对账：上次退出时还没做完的活
  void channels.reconcile().catch(error => log.warn('频道任务对账失败', { error: describeError(error) }))
}
