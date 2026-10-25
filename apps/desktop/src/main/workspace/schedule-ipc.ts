// 看板的定时任务（docs/ui/board-schedule.md）：把 core/project-tools 的调度器接到引擎、频道和 IPC。只调度本机的项目
import { describeError, logger } from '@pixelsky/engine'
import * as ipc from '../ipc/guard'
import { value } from '../core/project-tools/common'
import { ScheduleRunner } from '../core/project-tools/schedule-runner'
import type { AppContext } from '../app/context'

export function initSchedule(ctx: AppContext): void {
  const log = logger('schedule')
  const tools = ctx.projectTools
  if (!tools) return
  const runner = new ScheduleRunner({
    tasks: tools.tasks,
    call: (channel, args) => {
      if (!ctx.engineCall) return Promise.reject(new Error('项目尚未加载'))
      return ctx.engineCall(channel, args, 'schedule')
    },
    projects: () => ctx.engine?.projects() ?? [],
    sessions: () => ctx.engine?.sessions() ?? [],
    dispatch: (channelId, issue) => {
      if (!ctx.dispatchIssue) return Promise.reject(new Error('频道尚未加载'))
      return ctx.dispatchIssue(channelId, issue)
    },
    now: () => Date.now(),
    log: (message, error) => log.warn(message, error ? { error: describeError(error) } : undefined),
  })
  runner.start()
  ctx.lifecycle.onShutdown(() => runner.stop())
  ipc.handle('schedule:runNow', (_event, id) => runner.runNow(value(id, 200, true)))
}
