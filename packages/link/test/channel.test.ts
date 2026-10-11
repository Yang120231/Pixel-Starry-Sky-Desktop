import { describe, expect, it } from 'vitest'
import {
  FrameType,
  Initiator,
  Responder,
  SecureChannel,
  decodeFrame,
  fromUtf8,
  generateKeypair,
  type Codec,
  type HandshakeResult,
} from '../src'

// 测试用的「压缩」：前面加 1 字节再整体反转，能还原，也能看出确实走了压缩分支
let deflated = 0
const codec: Codec = {
  deflate(bytes) {
    deflated++
    return Uint8Array.from([42, ...bytes]).reverse()
  },
  async inflate(bytes, max) {
    if (bytes.length - 1 > max) throw new Error('too large')
    return Uint8Array.from(bytes).reverse().subarray(1)
  },
}

function keys(): { phone: HandshakeResult; desktop: HandshakeResult } {
  const p = generateKeypair(),
    d = generateKeypair()
  const i = new Initiator({ local: p, remote: d.publicKey })
  const r = new Responder({ local: d, remote: p.publicKey })
  r.readMessage1(i.writeMessage1())
  const { message, result } = r.writeMessage2()
  return { phone: i.readMessage2(message).result, desktop: result }
}

function pair() {
  const k = keys()
  const got: unknown[] = [],
    errors: Error[] = [],
    wire: Uint8Array[] = []
  const desktop = new SecureChannel(
    k.desktop,
    () => {},
    v => got.push(v),
    e => errors.push(e),
    codec,
  )
  const phone = new SecureChannel(
    k.phone,
    f => {
      wire.push(f)
      const { type, body } = decodeFrame(f)
      expect(type).toBe(FrameType.Data)
      desktop.receive(body)
    },
    () => {},
    () => {},
    codec,
  )
  return { phone, desktop, got, errors, wire }
}

const settle = () => new Promise(r => setTimeout(r, 0))

describe('SecureChannel', () => {
  it('keeps order across compressed and plain messages', async () => {
    const { phone, got, wire } = pair()
    const big = { text: 'x'.repeat(5000) }
    await Promise.all([phone.send({ n: 1 }), phone.send(big), phone.send({ n: 3 })])
    await settle()
    expect(got).toEqual([{ n: 1 }, big, { n: 3 }])
    expect(deflated).toBeGreaterThan(0)
    expect(() => fromUtf8(wire[1])).toThrow()
  })

  it('breaks the channel on a replayed frame', async () => {
    const { phone, desktop, got, errors, wire } = pair()
    await phone.send({ n: 1 })
    await settle()
    desktop.receive(decodeFrame(wire[0]).body)
    await settle()
    expect(errors.map(e => e.message)).toEqual(['LINK_DECRYPT_FAILED'])
    expect(desktop.closed).toBe(true)
    await phone.send({ n: 2 })
    await settle()
    expect(got).toEqual([{ n: 1 }])
  })

  it('fails one oversized message without breaking the channel', async () => {
    const k = keys()
    const sent: Uint8Array[] = []
    const ch = new SecureChannel(
      k.phone,
      f => sent.push(f),
      () => {},
      () => {},
    )
    await expect(ch.send({ text: 'y'.repeat(2 * 1024 * 1024) })).rejects.toThrow('LINK_FRAME_TOO_LARGE')
    await ch.send({ ok: true })
    expect(ch.closed).toBe(false)
    expect(sent).toHaveLength(1)
  })
})
