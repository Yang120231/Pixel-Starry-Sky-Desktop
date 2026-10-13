// 缓存用量的口径（GitHub #34，docs/ui/custom-api.md §11）：Anthropic 的 input_tokens 只算没命中缓存的部分，
// 缓存读写另算，三者相加才是整段输入。有些兼容 Anthropic 的上游（多半是从 OpenAI 格式转过来的）把缓存也算进了
// input_tokens：命中率被算成一半，总量、上下文用量翻倍，Claude Code 自己按上下文自动压缩也会提早一半。
// 网关转发响应时按线路 / 接口 + 模型判断口径，是「含缓存」的就把 input_tokens 改回标准口径，引擎和统计看到的都是对的。
import { logger } from '@pixelsky/engine'

const log = logger('gateway')

export type UsageMode = 'standard' | 'inclusive'

/** 连续这么多个请求看起来含缓存才认定（标准口径偶尔也会这样：没命中缓存的新内容比命中的还多） */
export const INCLUSIVE_AFTER = 2

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

export interface UsageRewriter {
  /** 一段完整的 SSE 事件（网关已按事件切好）：只解析带 usage 的 data 行，其余原样 */
  sse(text: string): string
  /** 非流式的整个响应体 */
  json(text: string): string
}

export class CacheUsageFix {
  private readonly modes = new Map<string, UsageMode>()
  private readonly streaks = new Map<string, number>()

  mode(key: string): UsageMode | undefined {
    return this.modes.get(key)
  }

  /**
   * 一个请求的响应。每个请求只按第一份带缓存读的 usage 判断一次口径（message_start 和 message_delta 不重复算）：
   * - 有缓存读、input < 缓存读：一定是标准口径（Claude Code 把缓存断点放在最后一条消息上，没命中的部分很小），
   *   记下以后不再改；
   * - 有缓存读、input ≥ 缓存读 + 缓存写：看起来含缓存，连续 INCLUSIVE_AFTER 个请求都这样才认定；
   * - 两者之间的不下结论。
   * 认定含缓存后，这个请求和之后的请求都把 input_tokens 减掉缓存读写。
   */
  request(key: string): UsageRewriter {
    let judged = false
    const fix = (usage: Record<string, unknown>): boolean => {
      const input = count(usage.input_tokens)
      if (input === null) return false
      const read = count(usage.cache_read_input_tokens) ?? 0,
        write = count(usage.cache_creation_input_tokens) ?? 0
      if (read > 0 && !judged) {
        judged = true
        this.judge(key, input, read, write)
      }
      if (this.modes.get(key) !== 'inclusive') return false
      const cached = input >= read + write ? read + write : input >= read ? read : 0
      if (!cached) return false
      usage.input_tokens = input - cached
      return true
    }
    /** message_start 的 usage 在 message 里，message_delta 和非流式响应的在最外层；没改返回 null */
    const message = (json: string): string | null => {
      let data: { usage?: unknown; message?: { usage?: unknown } }
      try {
        data = JSON.parse(json)
      } catch {
        return null
      }
      const usage = data?.message?.usage ?? data?.usage
      if (!usage || typeof usage !== 'object') return null
      return fix(usage as Record<string, unknown>) ? JSON.stringify(data) : null
    }
    return {
      sse(text) {
        if (!text.includes('"usage"')) return text
        return text.replace(/^data: ?(.*)$/gm, (line, json: string) => {
          if (!json.includes('"usage"')) return line
          const fixed = message(json)
          return fixed === null ? line : `data: ${fixed}`
        })
      },
      json(text) {
        return message(text) ?? text
      },
    }
  }

  private judge(key: string, input: number, read: number, write: number): void {
    const before = this.modes.get(key)
    if (before === 'standard') return
    if (input < read) {
      this.modes.set(key, 'standard')
      this.streaks.delete(key)
    } else if (input >= read + write) {
      const streak = (this.streaks.get(key) ?? 0) + 1
      this.streaks.set(key, streak)
      if (streak >= INCLUSIVE_AFTER) this.modes.set(key, 'inclusive')
    } else this.streaks.delete(key)
    const after = this.modes.get(key)
    if (after !== before)
      log.info(
        after === 'inclusive' ? '上游的 input_tokens 含缓存读写，转发时改成标准口径' : '上游的 input_tokens 是标准口径',
        { key, input, cacheRead: read, cacheWrite: write },
      )
  }
}
