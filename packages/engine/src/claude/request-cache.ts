import type { EngineEvent, RequestCacheUsage } from '@pixelsky/protocol'

type Raw = Record<string, unknown>
const obj = (v: unknown): Raw => v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {}
const str = (v: unknown): string => typeof v === 'string' ? v : ''
const KEYS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
interface Pending { id: string; model: string; usage: Raw; emitted: boolean }

/** 不从累计 result 反推缓存。合并同一消息的 start/delta/assistant，严格区分缺失与零。 */
export class RequestCacheReader {
  private pending = new Map<string, Pending>()
  private current = ''
  private turnId: string | null = null

  constructor(private readonly emit: (event: EngineEvent) => void) {}

  begin(turnId: string): void {
    this.finishPending()
    this.pending.clear()
    this.current = ''
    this.turnId = turnId
  }

  reset(): void {
    this.pending.clear()
    this.current = ''
    this.emit({ type: 'request_cache_reset' })
  }

  private finishPending(): void {
    if ([...this.pending.values()].some(p => !p.emitted)) this.emit({ type: 'request_cache_reset' })
  }

  private update(id: string, model: string, raw: unknown): void {
    if (!this.turnId || !id) { this.emit({ type: 'request_cache_reset' }); return }
    let p = this.pending.get(id)
    // 后续请求开始后才到达的旧完整消息不再作为一次新请求参与比较。
    if (p && id !== this.current) return
    if (!p) {
      if (this.current !== id) this.finishPending()
      // 只保留当前和已完成消息的 ID（同轮内去重），新轮会清空。
      p = { id, model, usage: {}, emitted: false }
      this.pending.set(id, p)
    }
    if (p.emitted) return
    this.current = id
    if (model) p.model = model
    const usage = obj(raw)
    for (const key of KEYS) if (Object.hasOwn(usage, key)) p.usage[key] = usage[key]
    if (!p.model || !KEYS.every(key => count(p!.usage[key]))) {
      this.emit({ type: 'request_cache_reset' })
      return
    }
    const input = p.usage.input_tokens as number
    const cacheRead = p.usage.cache_read_input_tokens as number
    const cacheWrite = p.usage.cache_creation_input_tokens as number
    // 某些代理在 message_start 给全零占位，等真实数据再建立基线。
    if (input + cacheRead + cacheWrite === 0) return
    p.emitted = true
    const request: RequestCacheUsage = { turnId: this.turnId, messageId: id, model: p.model, input, cacheRead, cacheWrite, observedAt: Date.now() }
    this.emit({ type: 'request_usage', request })
  }

  handle(frame: Raw): void {
    if (frame.parent_tool_use_id || frame.isReplay === true || frame.is_replay === true) return
    if (frame.type === 'system' && (frame.subtype === 'compact_boundary' || (frame.subtype === 'status' && frame.status === 'compacting'))) { this.reset(); return }
    if (!this.turnId) return
    if (frame.type === 'stream_event') {
      const event = obj(frame.event)
      if (event.type === 'message_start') {
        const message = obj(event.message)
        this.update(str(message.id), str(message.model), message.usage)
      } else if (event.type === 'message_delta' && this.current) {
        this.update(this.current, '', event.usage)
      } else if (event.type === 'message_stop') {
        const p = this.pending.get(this.current)
        if (p && !p.emitted) this.emit({ type: 'request_cache_reset' })
      }
    } else if (frame.type === 'assistant') {
      const message = obj(frame.message)
      this.update(str(message.id), str(message.model), message.usage)
    } else if (frame.type === 'result') {
      this.finishPending()
      this.turnId = null
    }
  }

  end(): void { this.finishPending(); this.turnId = null }
}
