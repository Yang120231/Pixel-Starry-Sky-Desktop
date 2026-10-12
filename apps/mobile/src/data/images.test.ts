import { describe, expect, it } from 'vitest'
import type { ImageAttachment } from '@pixelsky/protocol'
import {
  TOTAL_BUDGET,
  budgetFor,
  fitSize,
  imageDataUrl,
  imageError,
  imageKey,
  jpegName,
  knownImage,
  rememberImage,
} from './images'

const picture = (id: string, dataBase64 = ''): ImageAttachment => ({
  id,
  name: 'a.png',
  mediaType: 'image/png',
  bytes: 3,
  width: 10,
  height: 10,
  dataBase64,
})

describe('发图前压缩', () => {
  it('长边缩到上限以内、不放大、保持比例', () => {
    expect(fitSize(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitSize(1170, 2532, 1600)).toEqual({ width: 739, height: 1600 })
    expect(fitSize(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })

  it('张数越多每张越小，总量不超过一帧放得下的大小；文件名换成 .jpg', () => {
    expect(budgetFor(1)).toBe(TOTAL_BUDGET)
    expect(budgetFor(5) * 5).toBeLessThanOrEqual(TOTAL_BUDGET)
    // base64 后 + 文字仍在 1 MB 以内
    expect((TOTAL_BUDGET * 4) / 3).toBeLessThan(900 * 1024)
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg')
    expect(jpegName('截图')).toBe('截图.jpg')
    expect(jpegName('')).toBe('image.jpg')
  })
})

describe('看图', () => {
  it('条目里带数据的直接用；取过的按位置记住，自己发的按图片 id 记住', () => {
    expect(knownImage(picture('x', 'QUJD'), 'k')).toBe('data:image/png;base64,QUJD')
    expect(knownImage(picture('y'), imageKey('s', 'i', 0))).toBeNull()
    rememberImage(imageKey('s', 'i', 0), 'data:image/jpeg;base64,AAAA')
    expect(knownImage(picture('y'), imageKey('s', 'i', 0))).toBe('data:image/jpeg;base64,AAAA')
    rememberImage('mine', imageDataUrl({ mediaType: 'image/jpeg', dataBase64: 'BBBB' }))
    expect(knownImage(picture('mine'), 'other')).toBe('data:image/jpeg;base64,BBBB')
  })

  it('只记最近的 24 张', () => {
    for (let i = 0; i < 30; i++) rememberImage('n' + i, 'u' + i)
    expect(knownImage(picture('n0'), 'none')).toBeNull()
    expect(knownImage(picture('n29'), 'none')).toBe('u29')
  })

  it('取图失败的说明', () => {
    expect(imageError(new Error('MOBILE_UNSUPPORTED'))).toContain('版本太旧')
    expect(imageError(new Error('MOBILE_TOO_LARGE'))).toContain('太大')
    expect(imageError(new Error('别的'))).toBe('别的')
  })
})
