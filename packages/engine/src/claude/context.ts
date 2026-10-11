import {
  contextCount,
  contextDiagnostic,
  officialPrice,
  type ContextDetailLevel,
  type ContextDiagnostic,
  type ContextWindow,
  type EngineEvent,
} from '@pixelsky/protocol'
import { obj } from './shape'

type Frame = Record<string, unknown>
/** modelUsage 的键可能带 [1m] 之类的后缀，请求里返回的 model 不带 */
const bare = (model: string): string => model.replace(/\[[^\]]*\]$/, '')
const empty = (): ContextWindow => ({
  model: null,
  used: null,
  window: null,
  input: null,
  cacheRead: null,
  cacheWrite: null,
  output: null,
  observedAt: null,
  source: 'request',
  stale: false,
  compacting: false,
  diagnostic: null,
  diagnosticStale: false,
})

/** 合并同一主请求的明确计数；旧消息、累计结果、子智能体不会替换上下文。 */
export class ContextReader {
  private value = empty()
  private message = ''
  private capacities = new Map<string, number>()
  private seen = new Set<string>()
  constructor(private emit: (event: EngineEvent) => void) {}
  /** 最近一次知道的上下文占用（压缩开始时拿来当「压缩前」） */
  get used(): number | null {
    return this.value.used
  }
  /** 容量：先用 Claude Code 报的（每轮 result 才有），再按去掉后缀的名字对，都没有用官方价格表里的上下文长度 */
  private capacity(model: string): number | null {
    const exact = this.capacities.get(model)
    if (exact !== undefined) return exact
    for (const [name, window] of this.capacities) if (bare(name) === bare(model)) return window
    return officialPrice(model)?.contextWindow ?? null
  }
  private publish(): void {
    this.emit({ type: 'context', context: { ...this.value } })
  }
  reset(compacting = false, forgetWindow = false): void {
    this.message = ''
    this.seen.clear()
    if (forgetWindow) this.capacities.clear()
    this.value = {
      ...this.value,
      ...(forgetWindow ? { window: null } : {}),
      stale: this.value.observedAt !== null,
      compacting,
      diagnosticStale: !!this.value.diagnostic,
    }
    this.publish()
  }
  /** 结构化明细（/context 或 get_context_usage）；正在压缩时只解析不覆盖，压缩完会再取 */
  diagnostic(raw: unknown, detail?: ContextDetailLevel): ContextDiagnostic | null {
    const parsed = contextDiagnostic(raw)
    if (!parsed) return null
    const diagnostic = detail ? { ...parsed, detail } : parsed
    if (this.value.compacting) return diagnostic
    this.capacities.set(diagnostic.model, diagnostic.window)
    // 快速估算只补分类：已有最近请求的真实计数时，占用仍按请求口径（和 Claude Code 状态栏一致）
    if (detail === 'summary' && this.value.source === 'request' && this.value.used !== null && !this.value.stale) {
      this.value = { ...this.value, window: diagnostic.window, diagnostic, diagnosticStale: false }
      this.publish()
      return diagnostic
    }
    this.value = {
      ...this.value,
      model: diagnostic.model,
      used: diagnostic.used,
      window: diagnostic.window,
      observedAt: diagnostic.observedAt,
      source: 'diagnostic',
      stale: false,
      compacting: false,
      diagnostic,
      diagnosticStale: false,
    }
    this.publish()
    return diagnostic
  }
  private update(id: string, model: unknown, raw: unknown): void {
    if (!id || this.value.compacting || (this.seen.has(id) && this.message !== id)) return
    const name = typeof model === 'string' ? model : this.value.model
    if (!name || name === '<synthetic>') return
    if (this.message !== id) {
      this.message = id
      this.seen.add(id)
      if (this.seen.size > 512) this.seen = new Set([id])
      this.value = {
        ...empty(),
        model: name,
        window: this.capacity(name),
        diagnostic: this.value.diagnostic,
        diagnosticStale: !!this.value.diagnostic,
      }
    }
    const usage = obj(raw)
    const value = { ...this.value, model: name, source: 'request' as const, stale: false, compacting: false }
    for (const [key, field] of [
      ['input_tokens', 'input'],
      ['cache_read_input_tokens', 'cacheRead'],
      ['cache_creation_input_tokens', 'cacheWrite'],
      ['output_tokens', 'output'],
    ] as const) {
      if (Object.hasOwn(usage, key)) value[field] = contextCount(usage[key]) ? usage[key] : null
    }
    value.used =
      value.input !== null && value.cacheRead !== null && value.cacheWrite !== null
        ? value.input + value.cacheRead + value.cacheWrite
        : null
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
      const event = obj(frame.event),
        message = obj(event.message)
      if (event.type === 'message_start')
        this.update(typeof message.id === 'string' ? message.id : '', message.model, message.usage)
      else if (event.type === 'message_delta' && this.message) this.update(this.message, this.value.model, event.usage)
    } else if (frame.type === 'assistant') {
      if (frame.context_usage) {
        this.diagnostic(frame.context_usage)
        return
      }
      const message = obj(frame.message)
      this.update(typeof message.id === 'string' ? message.id : '', message.model, message.usage)
    } else if (frame.type === 'result') {
      if (this.value.compacting) {
        this.value = { ...this.value, compacting: false, stale: true, diagnosticStale: !!this.value.diagnostic }
        this.publish()
      }
      const models = obj(frame.modelUsage)
      for (const [model, raw] of Object.entries(models)) {
        const window = obj(raw).contextWindow
        if (contextCount(window) && window > 0) this.capacities.set(model, window)
      }
      const window = this.value.model ? this.capacity(this.value.model) : null
      if (window !== null && this.value.window !== window) {
        this.value = { ...this.value, window }
        this.publish()
      }
    }
  }
}
