import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesktopRegistrar, type RegisterInput } from './desktop-register'

const json = (status: number, body: unknown = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status })

function setup(over: Partial<RegisterInput> = {}, reply: () => Response = () => json(200, { keyChanged: false })) {
  const input: RegisterInput = { enabled: true, id: 'd1', name: 'PC', key: 'AAAA', regenerated: false, ...over }
  const state = { signedIn: true, scope: 'https://a|me' }
  const call = vi.fn(async (_m: string, _p: string, _b?: unknown) => reply())
  const warn = vi.fn()
  const r = createDesktopRegistrar({
    signedIn: () => state.signedIn,
    scope: () => state.scope,
    input: () => input,
    call,
    ver: '1.2.3',
    warn,
  })
  return { r, input, state, call, warn }
}

describe('createDesktopRegistrar', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('登记：POST 带名字、公钥、空 caps、版本', async () => {
    const { r, call } = setup()
    await r.sync()
    expect(call).toHaveBeenCalledWith('POST', '/v1/bridge/desktops/d1', {
      name: 'PC',
      publicKey: 'AAAA',
      caps: [],
      ver: '1.2.3',
    })
  })

  it('没开、没登录、没有密钥都不发', async () => {
    for (const over of [{ enabled: false }, { key: null }, { name: '  ' }]) {
      const { r, call } = setup(over)
      await r.sync()
      expect(call).not.toHaveBeenCalled()
    }
    const { r, call, state } = setup()
    state.signedIn = false
    await r.sync()
    expect(call).not.toHaveBeenCalled()
  })

  it('内容没变不重发；ID、名字、密钥变了才重发', async () => {
    const { r, call, input } = setup()
    await r.sync()
    await r.sync()
    expect(call).toHaveBeenCalledTimes(1)
    input.name = 'PC2'
    await r.sync()
    input.id = 'd2'
    await r.sync()
    input.key = 'BBBB'
    await r.sync()
    expect(call).toHaveBeenCalledTimes(4)
  })

  it('500 失败静默，下次同步还会再试', async () => {
    let status = 500
    const { r, call } = setup({}, () => json(status))
    await r.sync()
    status = 200
    await r.sync()
    await r.sync()
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('网络出错不抛', async () => {
    const { r, call } = setup()
    call.mockRejectedValueOnce(new Error('offline'))
    await expect(r.sync()).resolves.toBeUndefined()
  })

  it('keyChanged：不是自己重新生成的才警告', async () => {
    const a = setup({}, () => json(200, { keyChanged: true }))
    await a.r.sync()
    expect(a.warn).toHaveBeenCalledTimes(1)
    const b = setup({ regenerated: true }, () => json(200, { keyChanged: true }))
    await b.r.sync()
    expect(b.warn).not.toHaveBeenCalled()
  })

  it('同时多次调用合并成串行，最后按最新内容再登记一次', async () => {
    const { r, call, input } = setup()
    const first = r.sync()
    input.name = 'PC2'
    await Promise.all([first, r.sync()])
    expect(call.mock.calls.map(c => (c[2] as { name: string }).name)).toEqual(['PC', 'PC2'])
  })

  it('注销：DELETE，出错忽略，之后同样内容会重新登记', async () => {
    const { r, call } = setup()
    await r.sync()
    call.mockRejectedValueOnce(new Error('offline'))
    await expect(r.unregister('d1')).resolves.toBeUndefined()
    expect(call).toHaveBeenLastCalledWith('DELETE', '/v1/bridge/desktops/d1')
    await r.sync()
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('没登录不发注销', async () => {
    const { r, call, state } = setup()
    state.signedIn = false
    await r.unregister('d1')
    expect(call).not.toHaveBeenCalled()
  })

  it('登记途中关掉手机远程：补注销', async () => {
    const { r, call, input } = setup()
    call.mockImplementationOnce(async () => {
      input.enabled = false
      return json(200)
    })
    await r.sync()
    expect(call).toHaveBeenLastCalledWith('DELETE', '/v1/bridge/desktops/d1')
  })

  it('网络出错或 5xx：60 秒后自动再试一次，成功后不再试', async () => {
    const { r, call } = setup()
    call.mockRejectedValueOnce(new Error('offline'))
    await r.sync()
    expect(call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(call).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(call).toHaveBeenCalledTimes(2)

    const b = setup({}, () => json(503))
    await b.r.sync()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(b.call).toHaveBeenCalledTimes(2)
  })

  it('注销会取消待发的重试', async () => {
    const { r, call } = setup({}, () => json(500))
    await r.sync()
    await r.unregister('d1')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(call.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(1)
  })

  it('注销失败（离线）记下来，开关关着时下次同步重试，成功后不再发', async () => {
    const { r, call, input } = setup()
    await r.sync()
    input.enabled = false
    call.mockRejectedValueOnce(new Error('offline'))
    await r.unregister('d1')
    await r.sync()
    expect(call.mock.calls.filter(c => c[0] === 'DELETE')).toHaveLength(2)
    await r.sync()
    expect(call.mock.calls.filter(c => c[0] === 'DELETE')).toHaveLength(2)
  })

  it('注销时没登录：登录后下一次同步补发', async () => {
    const { r, call, state, input } = setup()
    input.enabled = false
    state.signedIn = false
    await r.unregister('d1')
    expect(call).not.toHaveBeenCalled()
    state.signedIn = true
    await r.sync()
    expect(call).toHaveBeenCalledWith('DELETE', '/v1/bridge/desktops/d1')
  })

  it('404 / 403 记住：同一个云端、账号、电脑 ID 不再发，换了才发', async () => {
    for (const status of [404, 403]) {
      const { r, call, input, state } = setup({}, () => json(status))
      await r.sync()
      await r.sync()
      expect(call).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(call).toHaveBeenCalledTimes(1)
      input.id = 'd2'
      await r.sync()
      expect(call).toHaveBeenCalledTimes(2)
      state.scope = 'https://b|me'
      await r.sync()
      expect(call).toHaveBeenCalledTimes(3)
      state.scope = 'https://b|you'
      await r.sync()
      expect(call).toHaveBeenCalledTimes(4)
    }
  })

  it('不管成功与否都把响应体读掉或取消', async () => {
    for (const status of [404, 500, 200]) {
      const res = json(status)
      const cancel = vi.spyOn(res.body!, 'cancel')
      const { r } = setup({}, () => res)
      await r.sync()
      // 200 的响应体被 json() 读完；其余的必须被取消
      expect(cancel).toHaveBeenCalledTimes(status === 200 ? 0 : 1)
    }
  })

  it('登记在途中关了又开：这次登记不记成已登记，下一轮重发', async () => {
    const { r, call } = setup()
    let release!: () => void
    call.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = () => resolve(json(200))
        }),
    )
    const first = r.sync()
    await vi.advanceTimersByTimeAsync(0)
    await r.unregister('d1')
    const second = r.sync()
    release()
    await Promise.all([first, second])
    const posts = call.mock.calls.filter(c => c[0] === 'POST')
    expect(posts).toHaveLength(2)
    await r.sync()
    expect(call.mock.calls.filter(c => c[0] === 'POST')).toHaveLength(2)
  })
})
