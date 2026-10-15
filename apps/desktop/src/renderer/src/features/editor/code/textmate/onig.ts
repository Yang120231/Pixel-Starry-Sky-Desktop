import type { IOnigLib } from 'vscode-textmate'

// onig.wasm 的加载：先用 ?url + fetch，任何失败（含 file:// 页面 fetch 不通）都退到主进程 IPC 取字节。结果缓存整个会话

type Bytes = ArrayBuffer | Uint8Array

/** 取 wasm 字节：fetch 失败或响应不 ok，退到 fallback；两个都失败就抛出 fallback 的错误 */
export async function loadOnigBytes(
  url: string,
  fetcher: (url: string) => Promise<Response>,
  fallback: () => Promise<Bytes>,
): Promise<Bytes> {
  try {
    const res = await fetcher(url)
    if (!res.ok) throw new Error(`onig.wasm ${res.status}`)
    return await res.arrayBuffer()
  } catch {
    return fallback()
  }
}

let cached: Promise<IOnigLib> | null = null

async function create(): Promise<IOnigLib> {
  const [oniguruma, urlModule] = await Promise.all([
    import('vscode-oniguruma'),
    import('vscode-oniguruma/release/onig.wasm?url'),
  ])
  const bytes = await loadOnigBytes(
    urlModule.default,
    u => fetch(u),
    async () => {
      const bridge = window.pixelsky?.extpacks
      if (!bridge) throw new Error('extpacks unavailable')
      return bridge.onigWasm()
    },
  )
  // 拷成独立的 ArrayBuffer，避免拿到 IPC 返回的视图带着多余的偏移
  const data = bytes instanceof Uint8Array ? (bytes.slice().buffer as ArrayBuffer) : bytes
  await oniguruma.loadWASM(data)
  return {
    createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
    createOnigString: s => new oniguruma.OnigString(s),
  }
}

export function onigLib(): Promise<IOnigLib> {
  return (cached ??= create())
}

/** 测试钩子：直接塞入（或清空）缓存的 onig 库 */
export function setOnigLibForTests(lib: IOnigLib | null): void {
  cached = lib ? Promise.resolve(lib) : null
}
