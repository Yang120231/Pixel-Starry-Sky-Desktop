// 子进程的标准输出：每行一条 JSON
import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

/** 按行读取流；坏掉的行（不是 JSON）交给 onBadLine，不会中断后面的行 */
export function readJsonLines(
  stream: Readable,
  onMessage: (msg: Record<string, unknown>) => void,
  onBadLine?: (line: string) => void,
): void {
  const decoder = new StringDecoder('utf8')
  let buf = ''
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
    buf += decoder.write(chunk)
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      flush(line)
    }
  })
  stream.on('end', () => {
    buf += decoder.end()
    if (buf) flush(buf)
    buf = ''
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
