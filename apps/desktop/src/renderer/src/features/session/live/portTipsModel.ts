// 对话里的「本机页面」提示条（docs/ui/port-preview.md）：从命令输出里找端口。
// 端口识别沿用代码模式端口页的 findPorts，这里只多做去掉终端颜色码和按会话去重
import type { Item } from '@pixelsky/protocol'
import { findPorts } from '@/features/coding/bottom/portsModel'
import { stripAnsi } from '@/features/terminal/history'

export interface FoundPort {
  port: number
  /** 产生它的命令，展开后每行显示 */
  command: string
}

const LOCAL_HOST = /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/

/** 输出里出现的本机端口；颜色码可能夹在 localhost: 和端口之间（vite 就这样），先去掉 */
export function portsOfOutput(output: string): number[] {
  return LOCAL_HOST.test(output) ? findPorts(stripAnsi(output)) : []
}

export type PortCache = Map<string, { output: string; ports: number[] }>

/** 会话里发现过的端口，按首次出现的顺序；同一端口只算一次。cache 让流式输出时没变的条目不重新扫描 */
export function discoverPorts(items: readonly Item[], cache?: PortCache): FoundPort[] {
  const seen = new Set<number>()
  const found: FoundPort[] = []
  for (const item of items) {
    if (item.kind !== 'command' || !item.output) continue
    let ports: number[]
    const hit = cache?.get(item.id)
    if (hit && hit.output === item.output) ports = hit.ports
    else {
      ports = portsOfOutput(item.output)
      cache?.set(item.id, { output: item.output, ports })
    }
    for (const port of ports)
      if (!seen.has(port)) {
        seen.add(port)
        found.push({ port, command: item.command })
      }
  }
  return found
}
