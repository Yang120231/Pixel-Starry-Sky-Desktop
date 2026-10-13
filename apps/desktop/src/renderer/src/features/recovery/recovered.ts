// 界面崩溃后主进程重新加载时在地址里带 ?recovered=<reason>&n=<次数>（docs/ui/renderer-memory.md §3.1.4）
export interface Recovered {
  /** Electron 的退出原因（oom、crashed……）；加载失败时是 load-failed */
  reason: string
  /** 10 分钟内第几次 */
  n: number
}

/** 解析地址里的查询参数；没有 recovered 就是正常启动 */
export function parseRecovered(search: string): Recovered | null {
  const params = new URLSearchParams(search)
  const reason = params.get('recovered')
  if (!reason) return null
  const n = Number.parseInt(params.get('n') ?? '', 10)
  return { reason: reason.slice(0, 40), n: Number.isFinite(n) && n > 0 ? n : 1 }
}

function readOnce(): Recovered | null {
  if (typeof location === 'undefined') return null
  const found = parseRecovered(location.search)
  // 去掉参数：不然用户手动刷新又会进轻量模式、又弹提示
  if (location.search && typeof history !== 'undefined')
    history.replaceState(null, '', location.pathname + location.hash)
  return found
}

/** 本次加载是不是崩溃后自动重新加载出来的；模块加载时读一次 */
export const recovered: Recovered | null = readOnce()
