import { describe, expect, it } from 'vitest'
import {
  IMAGE_PLACEHOLDER,
  imageMediaType,
  MAX_IMAGE_BYTES,
  validateImages,
  withoutShownImagePlaceholders,
} from '../src/images'
import type { ImageAttachment } from '../src/types'
import { itemSearchMatch } from '../src/search'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
const fixture = (): ImageAttachment => ({
  id: 'image-1',
  name: '中文图片.png',
  mediaType: 'image/png',
  width: 1,
  height: 1,
  bytes: (png.length / 4) * 3 - 2,
  dataBase64: png,
})
describe('图片输入边界', () => {
  it('保留原文件名、校验内容签名，拒绝类型伪装和无效 Base64', () => {
    expect(validateImages([fixture()])[0].name).toBe('中文图片.png')
    expect(() => validateImages([{ ...fixture(), mediaType: 'image/jpeg' }])).toThrow('内容不符')
    expect(() => validateImages([{ ...fixture(), dataBase64: '%%%=' }])).toThrow('数据不正确')
    expect(() => validateImages([{ ...fixture(), bytes: 1 }])).toThrow('数据不正确')
    expect(() => validateImages([{ ...fixture(), width: -1 }])).toThrow('尺寸不正确')
  })
  it('限制数量、单张、总大小与唯一 ID，空数组继续兼容文字消息', () => {
    expect(validateImages(undefined)).toEqual([])
    expect(() => validateImages({})).toThrow('格式不正确')
    expect(() => validateImages(Array(6).fill(fixture()))).toThrow('5 张')
    expect(() => validateImages([fixture(), fixture()])).toThrow('格式不正确')
    expect(() => validateImages([{ ...fixture(), bytes: MAX_IMAGE_BYTES + 1 }])).toThrow('10 MiB')
  })
  it('仅识别四种真实图片签名', () => {
    expect(imageMediaType(new Uint8Array([255, 216, 255, 224]))).toBe('image/jpeg')
    expect(imageMediaType(new Uint8Array([71, 73, 70, 56, 57, 97]))).toBe('image/gif')
    expect(imageMediaType(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]))).toBe('image/webp')
    expect(imageMediaType(new Uint8Array([60, 115, 118, 103]))).toBeNull()
  })
  it('附件 Base64 永远不作为聊天搜索文本', () => {
    const item = { kind: 'user' as const, id: 'u', text: '截图说明', attachments: [fixture()], createdAt: 1 }
    expect(itemSearchMatch(item, ['iVBOR'], 'all')).toBeNull()
    expect(itemSearchMatch(item, ['截图'], 'all')).not.toBeNull()
  })
  it('大图编码边界不会依赖递归正则，允许上限并拒绝总量超限', () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    // 大块编码只为边界校验，不代表这份填充数据可作为解码图片。
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const prefix = Array.from(bytes.slice(0, 9)).reduce(
      (s, _n, i, a) =>
        i % 3
          ? s
          : s +
            alphabet[a[i] >> 2] +
            alphabet[((a[i] & 3) << 4) | (a[i + 1] >> 4)] +
            alphabet[((a[i + 1] & 15) << 2) | (a[i + 2] >> 6)] +
            alphabet[a[i + 2] & 63],
      '',
    )
    const dataBase64 = prefix + 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 - prefix.length - 2) + '=='
    const image = { ...fixture(), bytes: MAX_IMAGE_BYTES, dataBase64 }
    expect(validateImages([image])[0].bytes).toBe(MAX_IMAGE_BYTES)
    expect(() => validateImages([image, { ...image, id: 'b' }, { ...fixture(), id: 'c' }])).toThrow('20 MiB')
  })
})

describe('withoutShownImagePlaceholders', () => {
  it('显示出来的图片不再重复占位；只剩占位时为空', () => {
    expect(withoutShownImagePlaceholders(IMAGE_PLACEHOLDER, 1)).toBe('')
    expect(withoutShownImagePlaceholders(`说明\n${IMAGE_PLACEHOLDER}`, 1)).toBe('说明')
  })
  it('超出上限没带上的图片仍保留占位', () => {
    expect(withoutShownImagePlaceholders(`${IMAGE_PLACEHOLDER}\n${IMAGE_PLACEHOLDER}`, 1)).toBe(IMAGE_PLACEHOLDER)
    expect(withoutShownImagePlaceholders(IMAGE_PLACEHOLDER, 0)).toBe(IMAGE_PLACEHOLDER)
  })
})
