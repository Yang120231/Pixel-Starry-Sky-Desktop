import type { TerminalEvent } from '../../../../shared/types/terminal'

export type DataEvent = Extract<TerminalEvent, { type: 'data' }>

export interface TerminalHistory {
  push(e: DataEvent): void
  events(): readonly DataEvent[]
  /** 去掉 ANSI 转义后的纯文本 */
  text(): string
}

/** 终端历史上限：每个终端最近 512 KiB */
export const HISTORY_LIMIT_BYTES = 512 * 1024

const encoder = new TextEncoder()
function byteLength(data: string): number {
  return encoder.encode(data).length
}

// CSI（含私有参数）、OSC（BEL 或 ST 结尾）、其它两字符转义、孤立的控制字符
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]|\u001b[()#][0-9A-Za-z]/g
export function stripAnsi(data: string): string {
  return (
    data
      .replace(ANSI, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\r\n/g, '\n')
  )
}

/**
 * 每个终端一个缓冲区，保存最近 limitBytes 字节的数据事件。
 * generation 变了（终端重启）就清空；超过上限时从最早的一条整条丢弃（至少保留最新一条）。
 */
export function createHistory(limitBytes: number): TerminalHistory {
  let list: DataEvent[] = []
  let sizes: number[] = []
  let total = 0
  let generation = -1
  return {
    push(e) {
      if (e.generation !== generation) {
        list = []
        sizes = []
        total = 0
        generation = e.generation
      }
      const size = byteLength(e.data)
      list.push(e)
      sizes.push(size)
      total += size
      let drop = 0
      while (total > limitBytes && drop < list.length - 1) total -= sizes[drop++]
      if (drop) {
        list = list.slice(drop)
        sizes = sizes.slice(drop)
      }
    },
    events: () => list,
    text: () => stripAnsi(list.map(e => e.data).join('')),
  }
}
