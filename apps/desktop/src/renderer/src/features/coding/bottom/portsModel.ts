// 端口页的纯逻辑：从终端文字里找本机地址的端口，再和服务的端口合并

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{1,5})/gi

/** 找出文字里出现过的本机端口（http(s)://localhost|127.0.0.1|0.0.0.0|[::1]:NNNN），去重并从小到大排 */
export function findPorts(text: string): number[] {
  const found = new Set<number>()
  for (const match of text.matchAll(URL_RE)) {
    const port = Number(match[1])
    if (port >= 1 && port <= 65535) found.add(port)
  }
  return [...found].sort((a, b) => a - b)
}

export interface PortSource {
  /** 来自哪里：终端名或服务名 */
  label: string
  kind: 'terminal' | 'service'
}
export interface PortEntry {
  port: number
  url: string
  sources: PortSource[]
}

export function portUrl(port: number): string {
  return `http://localhost:${port}`
}

/** 合并终端文字和服务端口；同一个端口只留一行，来源累加，按端口排序 */
export function mergePorts(
  terminals: readonly { label: string; text: string }[],
  services: readonly { label: string; port: number | null }[],
): PortEntry[] {
  const map = new Map<number, PortSource[]>()
  const add = (port: number, source: PortSource): void => {
    const list = map.get(port) ?? []
    if (!list.some(s => s.kind === source.kind && s.label === source.label)) list.push(source)
    map.set(port, list)
  }
  for (const service of services) {
    if (service.port && service.port >= 1 && service.port <= 65535)
      add(service.port, { label: service.label, kind: 'service' })
  }
  for (const terminal of terminals) {
    for (const port of findPorts(terminal.text)) add(port, { label: terminal.label, kind: 'terminal' })
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([port, sources]) => ({ port, url: portUrl(port), sources }))
}

/** 手动输入的端口：只收 1–65535 的整数，其它（带小数、带字母、空）返回 null */
export function parsePort(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,5}$/.test(t)) return null
  const port = Number(t)
  return port >= 1 && port <= 65535 ? port : null
}

/** 端口入口（提示条、空状态）发的就是 portUrl(port)，没有路径；带路径的请求（服务的健康检查地址）要照样导航过去 */
export const isPortUrl = (url: string): boolean => /^http:\/\/localhost:\d+$/.test(url)

/** 同一个本机服务（协议加主机端口相同）已经开着一页就切回去，不再新开一页；file:// 等不算 */
export function sameService(open: string, url: string): boolean {
  try {
    const a = new URL(url)
    return /^https?:$/.test(a.protocol) && new URL(open).origin === a.origin
  } catch {
    return false
  }
}
