import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FrameType,
  Initiator,
  PROLOGUE,
  RpcCore,
  SecureChannel,
  decodeFrame,
  decodeJson,
  decodeOffer,
  encodeFrame,
  encodeJson,
  fromBase64Url,
  generateKeypair,
  pairRequest,
  type Codec,
  type Keypair,
} from '@pixelsky/link'
import type { SessionSummary } from '@pixelsky/protocol'
import { MobileGateway, PAIRING_TTL, phoneSessions, sanitize, type GatewayDeps } from './gateway'
import type { StoredDevice } from './store'

const codec: Codec = {
  deflate: b => new Uint8Array(deflateRawSync(b)),
  inflate: (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max })),
}
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))

const summary = (id: string, updatedAt: number, archivedAt: number | null = null): SessionSummary =>
  ({ record: { id, title: id, updatedAt, archivedAt }, state: 'idle' }) as unknown as SessionSummary

class Phone {
  readonly key: Keypair = generateKeypair()
  readonly results: unknown[] = []
  readonly events: unknown[] = []
  rpc: RpcCore | null = null
  private channel: SecureChannel | null = null
  private handshake: ((body: Uint8Array) => void) | null = null
  constructor(
    readonly id: string,
    private readonly gateway: () => MobileGateway,
  ) {}
  deliver(frame: Uint8Array): void {
    const { type, body } = decodeFrame(frame)
    if (type === FrameType.PairResult) this.results.push(decodeJson(body))
    else if (type === FrameType.Handshake2) this.handshake?.(body)
    else if (type === FrameType.Data) this.channel?.receive(body)
  }
  pair(offerText: string, name = '测试手机'): void {
    const offer = decodeOffer(offerText)
    this.gateway().receive(
      this.id,
      encodeFrame(FrameType.Pair, encodeJson(pairRequest(offer, this.key.publicKey, name))),
    )
  }
  async connect(desktop: Uint8Array): Promise<boolean> {
    const initiator = new Initiator({ local: this.key, remote: desktop, prologue: PROLOGUE })
    const done = new Promise<boolean>(resolve => {
      this.handshake = body => {
        const { result } = initiator.readMessage2(body)
        let rpc: RpcCore | null = null
        const channel = new SecureChannel(
          result,
          f => this.gateway().receive(this.id, f),
          v => rpc?.receive(v),
          () => rpc?.close(),
          codec,
        )
        rpc = new RpcCore(m => void channel.send(m))
        rpc.onEvent = (_c, data) => this.events.push(data)
        this.channel = channel
        this.rpc = rpc
        resolve(true)
      }
      setTimeout(() => resolve(false), 50)
    })
    this.gateway().receive(this.id, encodeFrame(FrameType.Handshake1, initiator.writeMessage1()))
    return done
  }
  call(method: string, ...args: unknown[]): Promise<unknown> {
    return this.rpc!.call(method, args, 2000)
  }
}

function setup() {
  const desktop = generateKeypair()
  const devices: StoredDevice[] = []
  const calls: [string, unknown[], string][] = []
  const phones = new Map<string, Phone>()
  const cloudCalls: string[] = []
  let now = 1_000_000
  const deps: GatewayDeps = {
    store: {
      desktopId: 'desk-1',
      keypair: () => desktop,
      device: id => devices.find(d => d.id === id),
      addDevice: d => {
        const stored = { ...d, lastSeenAt: null }
        devices.push(stored)
        return stored
      },
      touch: () => {},
    },
    desktopName: () => '测试电脑',
    relay: () => 'ws://127.0.0.1:1',
    call: async (channel, args, owner) => {
      calls.push([channel, args, owner])
      if (channel === 'engine:sessions') return [summary('old', 1), summary('archived', 9, 5), summary('new', 3)]
      if (channel === 'engine:openSessionTail') return { snapshot: { items: [] }, seq: 1 }
      return { ok: channel }
    },
    send: (phone, frame) => phones.get(phone)?.deliver(frame),
    codec,
    cloud: {
      pairing: async () => (cloudCalls.push('pairing'), { code: 'cloud-code', expiresAt: now + 60_000 }),
      confirm: async phone => void cloudCalls.push('confirm ' + phone),
      remove: async phone => void cloudCalls.push('remove ' + phone),
    },
    changed: () => {},
    now: () => now,
  }
  const gateway = new MobileGateway(deps)
  const phone = (id: string) => {
    const p = new Phone(id, () => gateway)
    phones.set(id, p)
    return p
  }
  return { gateway, desktop, devices, calls, cloudCalls, phone, tick: (ms: number) => (now += ms) }
}

/** 配对并连上的手机 */
async function paired(t: ReturnType<typeof setup>, id = 'p1') {
  const p = t.phone(id)
  p.pair((await t.gateway.startPairing()).offer)
  await t.gateway.decide(true)
  expect(await p.connect(t.desktop.publicKey)).toBe(true)
  return p
}

const gateways: MobileGateway[] = []
afterEach(() => gateways.splice(0).forEach(g => g.close()))

describe('MobileGateway pairing', () => {
  it('pairs a phone that scanned the QR code after the user confirms', async () => {
    const t = setup()
    const p = t.phone('p1')
    const offer = await t.gateway.startPairing()
    expect(decodeOffer(offer.offer)).toMatchObject({ desktop: 'desk-1', name: '测试电脑', relay: 'ws://127.0.0.1:1' })
    expect(fromBase64Url(decodeOffer(offer.offer).key)).toEqual(t.desktop.publicKey)
    p.pair(offer.offer, 'Pixel 9')
    expect(t.gateway.pairingState()).toMatchObject({ status: 'confirm', request: { name: 'Pixel 9' } })
    expect(p.results).toEqual([{ status: 'pending' }])
    // 等确认时第二部手机扫同一个码：不理
    const other = t.phone('p2')
    other.pair(offer.offer)
    expect(other.results).toEqual([])
    await t.gateway.decide(true)
    expect(p.results).toEqual([{ status: 'pending' }, { status: 'accepted' }])
    expect(t.devices).toMatchObject([{ id: 'p1', name: 'Pixel 9', access: 'act' }])
    // 二维码里带云端配对码；确认先经过云端
    expect(decodeOffer(offer.offer).code).toBe('cloud-code')
    expect(t.cloudCalls).toEqual(['pairing', 'confirm p1'])
  })

  it('ignores forged, expired and rejected requests', async () => {
    const t = setup()
    const p = t.phone('p1')
    const offer = (await t.gateway.startPairing()).offer
    const forged = decodeOffer(offer)
    forged.secret = 'AAAAAAAAAAAAAAAAAAAAAA'
    t.gateway.receive('p1', encodeFrame(FrameType.Pair, encodeJson(pairRequest(forged, p.key.publicKey, 'x'))))
    expect(t.gateway.pairingState()?.status).toBe('waiting')
    t.tick(PAIRING_TTL + 1)
    expect(t.gateway.pairingState()?.status).toBe('expired')
    p.pair(offer)
    expect(p.results).toEqual([])
    await t.gateway.startPairing()
    p.pair(t.gateway.pairingState()!.offer)
    await t.gateway.decide(false)
    expect(p.results).toEqual([{ status: 'pending' }, { status: 'rejected' }])
    expect(t.devices).toEqual([])
    expect(t.cloudCalls.at(-1)).toBe('remove p1')
  })

  it('tells an unknown phone to pair again instead of shaking hands', async () => {
    const t = setup()
    const p = t.phone('stranger')
    expect(await p.connect(t.desktop.publicKey)).toBe(false)
    expect(p.results).toEqual([{ status: 'rejected' }])
    expect(t.gateway.online('stranger')).toBe(false)
  })
})

describe('MobileGateway calls', () => {
  it('serves allowed calls over the encrypted channel', async () => {
    const t = setup()
    gateways.push(t.gateway)
    const p = await paired(t)
    expect(t.gateway.online('p1')).toBe(true)
    expect(await p.call('hello')).toEqual({ version: 1, name: '测试电脑', access: 'act' })
    const sessions = (await p.call('engine:sessions')) as SessionSummary[]
    expect(sessions.map(s => s.record.id)).toEqual(['new', 'old'])
    await p.call('engine:createSession', { projectId: 'proj', engine: 'codex', permissionMode: 'full', platform: {} })
    await p.call('engine:send', 's1', { text: 'hi', clientMessageId: 'c1', settings: { model: 'x' } })
    expect(t.calls.slice(-2)).toEqual([
      ['engine:createSession', [{ projectId: 'proj', engine: 'codex' }], 'mobile:p1'],
      ['engine:send', ['s1', { text: 'hi', clientMessageId: 'c1' }], 'mobile:p1'],
    ])
    await expect(p.call('engine:deleteSession', 's1')).rejects.toThrow('MOBILE_UNSUPPORTED')
    await expect(p.call('engine:updateSession', 's1', { permissionMode: 'full' })).rejects.toThrow('MOBILE_UNSUPPORTED')
    await expect(p.call('files:read', {})).rejects.toThrow('MOBILE_UNSUPPORTED')
  })

  it('lets a view-only phone read but not act, and cuts off a revoked phone', async () => {
    const t = setup()
    gateways.push(t.gateway)
    const p = await paired(t)
    t.devices[0].access = 'view'
    await expect(p.call('engine:send', 's1', 'hi')).rejects.toThrow('MOBILE_FORBIDDEN')
    await expect(p.call('engine:answer', 's1', 'r1', { kind: 'allow' })).rejects.toThrow('MOBILE_FORBIDDEN')
    expect(await p.call('engine:openSessionTail', 's1')).toEqual({ snapshot: { items: [] }, seq: 1 })
    t.devices.splice(0)
    await expect(p.call('engine:sessions')).rejects.toThrow('MOBILE_REVOKED')
    await wait()
    expect(t.gateway.online('p1')).toBe(false)
  })

  it('pushes events only for watched sessions and throttles the session list', async () => {
    const t = setup()
    gateways.push(t.gateway)
    const p = await paired(t)
    await p.call('engine:openSessionTail', 's1')
    const event = (sessionId: string, text: string) => ({
      kind: 'session',
      sessionId,
      seq: 2,
      event: { kind: 'item_delta', itemId: 'a', delta: text },
    })
    t.gateway.hostEvent('engine:event', [event('s1', 'x'.repeat(10_000))])
    t.gateway.hostEvent('engine:event', [event('s2', 'not watched')])
    t.gateway.hostEvent('machines:changed', [{}])
    for (let i = 0; i < 5; i++)
      t.gateway.hostEvent('engine:event', [{ kind: 'sessions', sessions: [summary('a', i), summary('b', 9, 1)] }])
    await wait(20)
    expect(p.events).toHaveLength(1)
    expect(JSON.stringify(p.events[0]).length).toBeLessThan(5000)
    await wait(550)
    expect(p.events).toHaveLength(2)
    expect(p.events[1]).toMatchObject({ kind: 'sessions', sessions: [{ record: { id: 'a', updatedAt: 4 } }] })
    await p.call('unwatch', 's1')
    t.gateway.hostEvent('engine:event', [event('s1', 'y')])
    await wait(20)
    expect(p.events).toHaveLength(2)
  })

  it('tells a removed phone before disconnecting it', async () => {
    const t = setup()
    gateways.push(t.gateway)
    const p = await paired(t)
    t.devices.splice(0)
    t.gateway.revoke('p1')
    expect(p.results.at(-1)).toEqual({ status: 'rejected' })
    expect(t.gateway.online('p1')).toBe(false)
  })

  it('drops the phone when a frame does not decrypt', async () => {
    const t = setup()
    gateways.push(t.gateway)
    await paired(t)
    t.gateway.receive('p1', encodeFrame(FrameType.Data, new Uint8Array(64)))
    await wait()
    expect(t.gateway.online('p1')).toBe(false)
  })
})

describe('helpers', () => {
  it('keeps only recent, unarchived sessions for the phone', () => {
    const list = Array.from({ length: 250 }, (_, i) => summary(String(i), i, i % 2 ? 1 : null))
    const out = phoneSessions(list)
    expect(out).toHaveLength(125)
    expect(out[0].record.id).toBe('248')
  })
  it('rejects bad arguments before they reach the engine', () => {
    expect(() => sanitize('engine:createSession', [{}])).toThrow('MOBILE_BAD_ARGUMENT')
    expect(() => sanitize('engine:send', ['s', { text: 'x' }])).toThrow('MOBILE_BAD_ARGUMENT')
    expect(sanitize('engine:interrupt', ['s'])).toEqual(['s'])
  })
})
