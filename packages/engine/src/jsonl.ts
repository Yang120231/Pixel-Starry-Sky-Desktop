// 子进程的标准输出：每行一条 JSON
import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

/** 单个字符串值超过这么多字符就截短（docs/engine-output-limits.md）：几乎都是 base64 图片或超长命令输出，界面用不到全文 */
export const STRING_KEEP = 1024 * 1024
/** 截短之后一行还超过这么多字符：整行丢掉，不结束进程 */
export const LINE_MAX = 64 * 1024 * 1024
/** 丢掉的行留下开头这么多字符，用来认出是哪条消息 */
const DROPPED_HEAD = 300

/** 丢掉的一行：原长（字符）和开头 */
export interface DroppedLine {
  length: number
  head: string
}

/**
 * 按 \n 切行的增量切分器，边收边把超长的字符串值截短（docs/engine-output-limits.md）：
 * 单个字符串超过 STRING_KEEP 时只留开头加「已截断」说明，data: 开头的（图片）整个换成占位，
 * 所以不管引擎发来的一行原本多大，攒在内存里的都只有几 MB；截短后仍超过 LINE_MAX 的整行交给 onDrop。
 * 没有换行的块先攒进数组，找到换行时才拼成一行（审查报告 D12）
 */
export class LineSplitter {
  private parts: string[] = []
  private len = 0
  /** 这一行原本的字符数 */
  private total = 0
  private dropping = false
  private head = ''
  private inString = false
  /** 转义：0 不在转义里，-1 刚读到 \，大于 0 是 \u 后面还差几个十六进制数字 */
  private escape = 0
  /** 当前字符串：原长、开头几个字符、在输出里从哪开始、是否已开始跳过 */
  private strTotal = 0
  private strPrefix = ''
  private strStart = 0
  private skipping = false

  constructor(private readonly onDrop?: (line: DroppedLine) => void) {}

  /** 喂入一块文本，返回这一块里凑齐的整行（不含 \n） */
  push(text: string): string[] {
    const lines: string[] = []
    let from = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 10) {
        this.keep(text, from, i)
        this.finish(lines)
        from = i + 1
        continue
      }
      if (!this.inString) {
        if (c === 34) {
          this.inString = true
          this.escape = 0
          this.strTotal = 0
          this.strPrefix = ''
          this.strStart = this.len + (i + 1 - from)
        }
        continue
      }
      if (this.escape === -1) this.escape = c === 117 ? 4 : 0
      else if (this.escape > 0) this.escape--
      else if (c === 92) this.escape = -1
      else if (c === 34) {
        this.inString = false
        if (this.skipping) {
          this.keep(text, from, i)
          this.skipping = false
          const note = this.strPrefix.startsWith('data:')
            ? `[图片已省略，原长 ${this.strTotal} 字符]`
            : `…[已截断，原长 ${this.strTotal} 字符]`
          this.append(note)
          from = i
        }
        continue
      }
      this.strTotal++
      if (this.strPrefix.length < 5) this.strPrefix += text[i]
      // 只在一个完整的转义之后截，免得留下半个 \uXXXX
      if (!this.skipping && this.strTotal > STRING_KEEP && this.escape === 0) {
        this.keep(text, from, i + 1)
        from = i + 1
        this.skipping = true
        if (this.strPrefix.startsWith('data:') && !this.dropping) {
          const joined = this.parts.join('').slice(0, this.strStart)
          this.parts = [joined]
          this.len = joined.length
        }
      }
    }
    this.keep(text, from, text.length)
    return lines
  }

  /** 流结束：取出剩下没有换行的部分（丢掉的行返回空） */
  end(): string {
    const tail = this.dropping ? '' : this.parts.join('')
    this.reset()
    return tail
  }

  private keep(text: string, from: number, to: number): void {
    this.total += to - from
    if (!this.skipping && to > from) this.append(text.slice(from, to))
  }

  private append(piece: string): void {
    if (this.dropping) return
    if (this.len + piece.length > LINE_MAX) {
      this.dropping = true
      this.head = (this.parts.join('') + piece).slice(0, DROPPED_HEAD)
      this.parts = []
      this.len = 0
      return
    }
    this.parts.push(piece)
    this.len += piece.length
  }

  private finish(lines: string[]): void {
    if (this.dropping) this.onDrop?.({ length: this.total, head: this.head })
    else lines.push(this.parts.length === 1 ? this.parts[0] : this.parts.join(''))
    this.reset()
  }

  private reset(): void {
    this.parts = []
    this.len = 0
    this.total = 0
    this.dropping = false
    this.head = ''
    this.inString = false
    this.escape = 0
    this.skipping = false
  }
}

/** 丢掉的行是哪条消息：开头里第一个 id，和 key 字段（Codex 是 method，像素星空是 type）；认不出为 null */
export function droppedRef(head: string, key: 'method' | 'type'): { id: string | number | null; kind: string | null } {
  const id = /"id"\s*:\s*(?:(\d+)|"((?:[^"\\]|\\.)*)")/.exec(head)
  const kind = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(head)
  return { id: id ? (id[1] !== undefined ? Number(id[1]) : id[2]) : null, kind: kind?.[1] ?? null }
}

/** 按行读取流；坏掉的行（不是 JSON）交给 onBadLine，不会中断后面的行 */
export function readJsonLines(
  stream: Readable,
  onMessage: (msg: Record<string, unknown>) => void,
  onBadLine?: (line: string) => void,
): void {
  const decoder = new StringDecoder('utf8')
  const splitter = new LineSplitter(dropped => onBadLine?.(dropped.head))
  const flush = (line: string): void => {
    const t = line.trim()
    if (!t) return
    let msg: unknown
    try {
      msg = JSON.parse(t)
    } catch {
      onBadLine?.(t)
      return
    }
    if (msg && typeof msg === 'object' && !Array.isArray(msg)) onMessage(msg as Record<string, unknown>)
    else onBadLine?.(t)
  }
  stream.on('data', (chunk: Buffer) => {
    for (const line of splitter.push(decoder.write(chunk))) flush(line)
  })
  stream.on('end', () => {
    for (const line of splitter.push(decoder.end())) flush(line)
    const tail = splitter.end()
    if (tail) flush(tail)
  })
}

/** 只保留最后 max 个字符（用来留 stderr 的结尾，出错时给用户看） */
export class TailBuffer {
  private text = ''
  constructor(private readonly max = 4000) {}
  push(chunk: string): void {
    this.text += chunk
    if (this.text.length > this.max) this.text = this.text.slice(-this.max)
  }
  toString(): string {
    return this.text
  }
}
