// 查引擎在 npm 上的最新版本（docs/ui/engine-update.md）：用 Electron 的 net.fetch，走系统代理；
// npmjs.org 连不上时退到国内镜像 npmmirror。只读 /<包名>/latest 的 version 字段，不下载任何东西。
import { net } from 'electron'

const REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']
/** 启动后等一会儿再查，不跟启动抢网络；之后每 6 小时查一次 */
export const FIRST_CHECK_MS = 15_000
export const CHECK_EVERY_MS = 6 * 60 * 60_000

/** 只认 x.y.z（可带 -beta.1 这类后缀），别的都当没查到 */
export function parseLatest(body: unknown): string | null {
  const version = (body as { version?: unknown } | null)?.version
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version) ? version : null
}

export async function npmLatest(pkg: string): Promise<string | null> {
  if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9.-]+$/.test(pkg)) return null
  for (const registry of REGISTRIES) {
    try {
      const response = await net.fetch(`${registry}/${pkg}/latest`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        continue
      }
      const version = parseLatest(await response.json())
      if (version) return version
    } catch {
      /* 换下一个源 */
    }
  }
  return null
}

/** 定时查：启动后 15 秒一次，之后每 6 小时；返回停止函数 */
export function scheduleEngineUpdateChecks(check: () => Promise<void>): () => void {
  const run = () => void check().catch(() => undefined)
  const first = setTimeout(run, FIRST_CHECK_MS)
  const every = setInterval(run, CHECK_EVERY_MS)
  first.unref?.()
  every.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}
