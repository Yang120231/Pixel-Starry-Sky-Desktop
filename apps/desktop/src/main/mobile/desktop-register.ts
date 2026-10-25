// 电脑向账号登记自己（docs/account-login.md §5）：手机远程打开且中转连上后 POST /v1/bridge/desktops/{id}，
// 网页版据此在账号下列出这台电脑；关掉手机远程时 DELETE。云端旧版本（404）、没登录、没有系统密钥都静默跳过。
// 不依赖 electron，方便测试。
export interface RegisterInput {
  enabled: boolean
  id: string
  name: string
  /** 电脑公钥（base64url，和配对二维码里的 key 一样）；系统加密不可用为 null */
  key: string | null
  /** 这次启动重新生成了密钥（云端返回 keyChanged 是自己造成的，不是别的电脑冒用） */
  regenerated: boolean
}

export interface RegisterDeps {
  signedIn(): boolean
  /** 云端地址 + 当前账号；变了就当换了环境，之前记下的 404 / 403 作废 */
  scope(): string
  input(): RegisterInput
  call(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<Response>
  ver: string
  warn(msg: string): void
}

/** 失败（网络出错、5xx）后隔多久再试：每 60 秒试一次，直到成功、关掉开关或换了电脑 / 账号 */
const RETRY_MS = 60_000

export function createDesktopRegistrar(d: RegisterDeps) {
  // 云端已记下的内容；一样就不再发。失败、404 不记，下次连上中转再试
  let last: { id: string; name: string; key: string } | null = null
  // 云端返回 404（旧版本）/ 403 的 scope+电脑 ID：换了电脑 ID、账号、云端地址或重启才再试
  let refused: string | null = null
  // 还没注销成功的电脑 ID：下次同步 / 登录且开关还关着时重试
  let pendingUnregister: string | null = null
  let unregistering: Promise<void> | null = null
  // 每次注销加一：登记请求回来时已经变了，就不能记成「已登记」
  let gen = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false,
    again = false

  const cancelBody = (res: Response) => res.body?.cancel().catch(() => {})
  const clearRetry = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const retryLater = () => {
    clearRetry()
    timer = setTimeout(() => {
      timer = null
      void sync()
    }, RETRY_MS)
    timer.unref?.()
  }

  async function flushUnregister(): Promise<void> {
    const id = pendingUnregister
    if (!id || !d.signedIn()) return
    try {
      const res = await d.call('DELETE', `/v1/bridge/desktops/${encodeURIComponent(id)}`)
      await cancelBody(res)
      // 云端本来就没有（404）也算完成
      if ((res.ok || res.status === 404) && pendingUnregister === id) pendingUnregister = null
    } catch {
      // 离线：留着，下次同步再试
    }
  }

  async function once(): Promise<void> {
    if (unregistering) await unregistering
    const cur = d.input()
    if (cur.enabled) {
      if (pendingUnregister === cur.id) pendingUnregister = null
    } else if (pendingUnregister) return flushUnregister()
    const name = cur.name.trim().slice(0, 64)
    if (!cur.enabled || !d.signedIn() || !cur.key || !name) return
    if (last && last.id === cur.id && last.name === name && last.key === cur.key) return
    if (refused === `${d.scope()}|${cur.id}`) return
    clearRetry()
    const g = gen
    let res: Response
    try {
      res = await d.call('POST', `/v1/bridge/desktops/${encodeURIComponent(cur.id)}`, {
        name,
        publicKey: cur.key,
        caps: [],
        ver: d.ver.slice(0, 32),
      })
    } catch {
      return retryLater()
    }
    if (!res.ok) {
      await cancelBody(res)
      if (res.status === 404 || res.status === 403) refused = `${d.scope()}|${cur.id}`
      else if (res.status >= 500) retryLater()
      return
    }
    // 登记的路上用户关掉了手机远程：补一个注销
    if (!d.input().enabled) {
      await cancelBody(res)
      pendingUnregister = cur.id
      return flushUnregister()
    }
    // 登记的路上关了又开：注销可能先到云端，不能记成已登记，等下一轮重发
    if (g !== gen) return void (await cancelBody(res))
    last = { id: cur.id, name, key: cur.key }
    const data = (await res.json().catch(() => null)) as { keyChanged?: unknown } | null
    if (data?.keyChanged === true && !cur.regenerated)
      d.warn('云端记录的电脑公钥和本机不一致，可能有另一台电脑在用同一个电脑 ID')
  }

  /** 满足条件就登记；调用方在中转连上、电脑 ID / 名字 / 密钥可能变了、登录的时候调用。出错吞掉 */
  async function sync(): Promise<void> {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        await once().catch(() => {})
      } while (again)
    } finally {
      running = false
    }
  }

  return {
    sync,
    /** 用户关掉手机远程：从账号下的电脑列表去掉（已配对的手机不动）。失败的记下来，之后同步时重试 */
    async unregister(id: string): Promise<void> {
      gen++
      last = null
      clearRetry()
      pendingUnregister = id
      unregistering = flushUnregister()
      if (unregistering) await unregistering
    },
  }
}
