import { contextCount, contextDiagnostic, type ContextWindow, type EngineEvent } from '@pixelsky/protocol'

type Frame = Record<string, unknown>
const obj = (v: unknown): Frame => v && typeof v === 'object' && !Array.isArray(v) ? v as Frame : {}
const empty = (): ContextWindow => ({ model: null, used: null, window: null, input: null, cacheRead: null, cacheWrite: null, output: null, observedAt: null, source: 'request', stale: false, compacting: false, diagnostic: null, diagnosticStale: false })

/** 合并同一主请求的明确计数；旧消息、累计结果、子智能体不会替换上下文。 */
export class ContextReader {
  private value = empty()
  private message = ''
  private capacities = new Map<string, number>()
  private seen = new Set<string>()
  constructor(private emit: (event: EngineEvent) => void) {}
  private publish(): void { this.emit({ type: 'context', context: { ...this.value } }) }
  reset(compacting = false, forgetWindow = false): void {
    this.message = ''; this.seen.clear()
    if (forgetWindow) this.capacities.clear()
    this.value = { ...this.value, ...(forgetWindow ? { window: null } : {}), stale: this.value.observedAt !== null, compacting, diagnosticStale: !!this.value.diagnostic }
    this.publish()
  }
  diagnostic(raw: unknown): boolean {
    const diagnostic = contextDiagnostic(raw)
    if (!diagnostic) return false
    this.capacities.set(diagnostic.model, diagnostic.window)
    this.value = { ...this.value, model: diagnostic.model, used: diagnostic.used, window: diagnostic.window, observedAt: diagnostic.observedAt, source: 'diagnostic', stale: false, compacting: false, diagnostic, diagnosticStale: false }
    this.publish()
    return true
  }
  private update(id: string, model: unknown, raw: unknown): void {
    if (!id || this.value.compacting || (this.seen.has(id) && this.message !== id)) return
    const name = typeof model === 'string' ? model : this.value.model
    if (!name || name === '<synthetic>') return
    if (this.message !== id) {
      this.message = id; this.seen.add(id)
      if (this.seen.size > 512) this.seen = new Set([id])
      this.value = { ...empty(), model: name, window: this.capacities.get(name) ?? null, diagnostic: this.value.diagnostic, diagnosticStale: !!this.value.diagnostic }
    }
    const usage = obj(raw)
    const value = { ...this.value, model: name, source: 'request' as const, stale: false, compacting: false }
    for (const [key, field] of [['input_tokens', 'input'], ['cache_read_input_tokens', 'cacheRead'], ['cache_creation_input_tokens', 'cacheWrite'], ['output_tokens', 'output']] as const) {
      if (Object.hasOwn(usage, key)) value[field] = contextCount(usage[key]) ? usage[key] : null
    }
    value.used = value.input !== null && value.cacheRead !== null && value.cacheWrite !== null ? value.input + value.cacheRead + value.cacheWrite : null
    value.observedAt = Date.now()
    this.value = value
    this.publish()
  }
  handle(frame: Frame): void {
    if (frame.parent_tool_use_id || frame.isReplay === true || frame.is_replay === true) return
    if (frame.type === 'system') {
      if (frame.subtype === 'compact_boundary') this.reset(false)
      else if (frame.subtype === 'status' && frame.status === 'compacting') this.reset(true)
    } else if (frame.type === 'stream_event') {
      const event = obj(frame.event), message = obj(event.message)
      if (event.type === 'message_start') this.update(typeof message.id === 'string' ? message.id : '', message.model, message.usage)
      else if (event.type === 'message_delta' && this.message) this.update(this.message, this.value.model, event.usage)
    } else if (frame.type === 'assistant') {
      if (frame.context_usage) { this.diagnostic(frame.context_usage); return }
      const message = obj(frame.message)
      this.update(typeof message.id === 'string' ? message.id : '', message.model, message.usage)
    } else if (frame.type === 'result') {
      if (this.value.compacting) { this.value = { ...this.value, compacting: false, stale: true, diagnosticStale: !!this.value.diagnostic }; this.publish() }
      const models = obj(frame.modelUsage)
      for (const [model, raw] of Object.entries(models)) {
        const window = obj(raw).contextWindow
        if (contextCount(window) && window > 0) this.capacities.set(model, window)
      }
      const window = this.value.model ? this.capacities.get(this.value.model) : undefined
      if (window !== undefined && this.value.window !== window) { this.value = { ...this.value, window }; this.publish() }
    }
  }
}
