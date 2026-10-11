import { describe, expect, it } from 'vitest'
import { Initiator, Responder, generateKeypair, keypairFrom, toHex, utf8 } from '../src'
import vector from './noise-kk-vector.json'

const hex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], b => parseInt(b, 16))

describe('Noise KK', () => {
  it('matches the cacophony test vector', () => {
    const v = vector
    const i = new Initiator({
      local: keypairFrom(hex(v.init_static)),
      remote: hex(v.init_remote_static),
      ephemeral: keypairFrom(hex(v.init_ephemeral)),
      prologue: hex(v.init_prologue),
    })
    const r = new Responder({
      local: keypairFrom(hex(v.resp_static)),
      remote: hex(v.resp_remote_static),
      ephemeral: keypairFrom(hex(v.resp_ephemeral)),
      prologue: hex(v.resp_prologue),
    })
    const [m1, m2, ...rest] = v.messages
    const c1 = i.writeMessage1(hex(m1.payload))
    expect(toHex(c1)).toBe(m1.ciphertext)
    expect(toHex(r.readMessage1(c1))).toBe(m1.payload)
    const { message, result: rr } = r.writeMessage2(hex(m2.payload))
    expect(toHex(message)).toBe(m2.ciphertext)
    const { payload, result: ir } = i.readMessage2(message)
    expect(toHex(payload)).toBe(m2.payload)
    expect(toHex(ir.hash)).toBe(v.handshake_hash)
    expect(toHex(rr.hash)).toBe(v.handshake_hash)
    rest.forEach((m, k) => {
      const [from, to] = k % 2 === 0 ? [ir, rr] : [rr, ir]
      const sealed = from.send.seal(hex(m.payload))
      expect(toHex(sealed)).toBe(m.ciphertext)
      expect(toHex(to.receive.open(sealed))).toBe(m.payload)
    })
  })

  const session = () => {
    const phone = generateKeypair(),
      desk = generateKeypair()
    const i = new Initiator({ local: phone, remote: desk.publicKey })
    const r = new Responder({ local: desk, remote: phone.publicKey })
    r.readMessage1(i.writeMessage1())
    const { message, result: desktop } = r.writeMessage2()
    return { phone: i.readMessage2(message).result, desktop }
  }

  it('rejects a phone or desktop holding the wrong long-term key', () => {
    const phone = generateKeypair(),
      desk = generateKeypair(),
      mallory = generateKeypair()
    const fakePhone = new Initiator({ local: mallory, remote: desk.publicKey })
    expect(() =>
      new Responder({ local: desk, remote: phone.publicKey }).readMessage1(fakePhone.writeMessage1()),
    ).toThrow('LINK_HANDSHAKE_FAILED')
    const i = new Initiator({ local: phone, remote: desk.publicKey })
    expect(() => new Responder({ local: mallory, remote: phone.publicKey }).readMessage1(i.writeMessage1())).toThrow(
      'LINK_HANDSHAKE_FAILED',
    )
  })

  it('rejects tampered and replayed frames without advancing the counter', () => {
    const { phone, desktop } = session()
    const a = phone.send.seal(utf8('a')),
      b = phone.send.seal(utf8('b'))
    const tampered = a.slice()
    tampered[3] ^= 1
    expect(() => desktop.receive.open(tampered)).toThrow('LINK_DECRYPT_FAILED')
    expect(desktop.receive.open(a)).toEqual(utf8('a'))
    expect(() => desktop.receive.open(a)).toThrow('LINK_DECRYPT_FAILED')
    expect(desktop.receive.open(b)).toEqual(utf8('b'))
  })

  it('refuses messages in the wrong state or of the wrong size', () => {
    const phone = generateKeypair(),
      desk = generateKeypair()
    const i = new Initiator({ local: phone, remote: desk.publicKey })
    expect(() => i.readMessage2(new Uint8Array(48))).toThrow('LINK_HANDSHAKE_FAILED')
    expect(() => new Responder({ local: desk, remote: phone.publicKey }).readMessage1(new Uint8Array(10))).toThrow(
      'LINK_HANDSHAKE_FAILED',
    )
    expect(() => new Initiator({ local: phone, remote: new Uint8Array(5) })).toThrow('LINK_HANDSHAKE_FAILED')
  })
})
