import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { browserCodec } from './codec'

// 手机用浏览器的 CompressionStream，电脑用 zlib：两边要能互相解（Node 24 也有 CompressionStream）
describe('browserCodec', () => {
  const text = new TextEncoder().encode('像素星空 '.repeat(2000))
  it('inflates what the desktop deflated and the other way round', async () => {
    expect(await browserCodec.inflate(new Uint8Array(deflateRawSync(text)), 1 << 20)).toEqual(text)
    expect(new Uint8Array(inflateRawSync(await browserCodec.deflate(text)))).toEqual(text)
  })
  it('refuses to inflate past the limit', async () => {
    await expect(browserCodec.inflate(new Uint8Array(deflateRawSync(text)), 100)).rejects.toThrow(
      'LINK_FRAME_TOO_LARGE',
    )
  })
})
