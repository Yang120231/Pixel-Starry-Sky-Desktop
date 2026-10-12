import { LINK_VERSION, encodeOffer, type PairingOffer } from '@pixelsky/link'
import { describe, expect, it } from 'vitest'
import { findOffer } from './offer'

const make = (over: Partial<PairingOffer> = {}): PairingOffer => ({
  v: LINK_VERSION,
  relay: 'wss://auth.example/relay',
  desktop: 'desk-1',
  key: 'A'.repeat(43),
  secret: 'B'.repeat(22),
  name: '我的电脑',
  expires: Date.now() + 5 * 60_000,
  code: 'code-1',
  ...over,
})
const web = 'https://auth.example/m/'

describe('findOffer', () => {
  it('reads a bare web link and a pixelsky link', () => {
    expect(findOffer(encodeOffer(make(), web)).desktopName).toBe('我的电脑')
    expect(findOffer(encodeOffer(make())).raw.desktop).toBe('desk-1')
  })
  it('finds the link inside words, newlines and trailing punctuation', () => {
    const link = encodeOffer(make(), web)
    expect(findOffer(`快来连我：\n  ${link}。\n（5 分钟内有效）`).raw.code).toBe('code-1')
    expect(findOffer(`<${link}>,`).raw.code).toBe('code-1')
  })
  it('reads a percent-encoded link', () => {
    expect(findOffer(encodeURIComponent(encodeOffer(make(), web))).raw.code).toBe('code-1')
  })
  it('rejoins a link that a chat app wrapped across lines', () => {
    const link = encodeOffer(make(), web)
    const cut = link.length - 40
    expect(findOffer(`${link.slice(0, cut)}\n${link.slice(cut)}`).raw.code).toBe('code-1')
  })
  it('picks the usable link when several are pasted', () => {
    const good = encodeOffer(make(), web)
    const old = encodeOffer(make({ expires: Date.now() - 1, code: 'old' }), web)
    expect(findOffer(`${old}  ${good}`).raw.code).toBe('code-1')
    expect(
      findOffer(`${old}
${good}`).raw.code,
    ).toBe('code-1')
    expect(findOffer(`https://x.example/m/#pair=abc  ${good}`).raw.code).toBe('code-1')
  })
  it('says what is wrong', () => {
    expect(() => findOffer('你好 world')).toThrow('没有找到配对链接')
    expect(() => findOffer('')).toThrow('没有找到配对链接')
    expect(() => findOffer('https://x.example/m/#pair=abc')).toThrow('不对')
    expect(() => findOffer('https://x.example/m/#pair=')).toThrow('不完整')
    expect(() => findOffer(encodeOffer(make({ expires: Date.now() - 1 }), web))).toThrow('已经过期')
  })
})
