// 缓存命中监控：同一主请求链里有效缓存明显下降时提醒，每轮最多一次（docs/ui/cache-miss-warning.md）
import type { EngineEvent } from '@pixelsky/protocol'
import { CacheWatch } from '../cache-watch'
import type { HostContext, Runtime } from './context'

type RequestUsage = Extract<EngineEvent, { type: 'request_usage' }>['request']

export class HostCache {
  private readonly watches = new Map<string, CacheWatch>()
  private readonly alertTurns = new Map<string, string>()

  constructor(private readonly ctx: HostContext) {}

  /** 换模型 / 线路 / 引擎、回退、引擎要求重置时重新建立基线 */
  reset(id: string): void {
    this.watches.delete(id)
  }

  /** 删除会话：基线和已提醒的轮次一起清掉 */
  forget(id: string): void {
    this.watches.delete(id)
    this.alertTurns.delete(id)
  }

  check(id: string, rt: Runtime, r: RequestUsage): void {
    const record = rt.execution ?? rt.snapshot.record
    const route = JSON.stringify([record.engine, record.model, record.platform ?? null, record.provider?.id ?? null])
    let watch = this.watches.get(id)
    if (!watch) {
      watch = new CacheWatch()
      this.watches.set(id, watch)
    }
    const miss = watch.check(r, route)
    if (miss && this.alertTurns.get(id) !== r.turnId) {
      this.alertTurns.set(id, r.turnId)
      this.ctx.opts.emit({
        kind: 'cache_warning',
        warning: {
          sessionId: id,
          turnId: r.turnId,
          messageId: r.messageId,
          title: rt.snapshot.record.title,
          model: r.model,
          input: miss.input,
          cached: r.cacheRead,
          previousInput: miss.previousInput,
          expiresAt: r.observedAt + 5_000,
        },
      })
    }
  }
}
