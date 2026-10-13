import { describe, expect, it } from 'vitest'
import { needsConversion, otherImageFormat } from './convertImage'
import { isImageFile } from './files'

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)))
/** ISO 媒体文件开头的 ftyp 盒子：大小、ftyp、主品牌、版本、兼容品牌 */
const ftyp = (major: string, ...compatible: string[]): Uint8Array =>
  bytes([0, 0, 0, 16 + 4 * compatible.length], 'ftyp', major, [0, 0, 0, 0], compatible.join(''))

describe('要转的图片格式', () => {
  it('按开头的字节认 BMP、ICO、TIFF、AVIF、HEIC', () => {
    expect(otherImageFormat(bytes('BM', new Array(40).fill(0)))).toBe('bmp')
    expect(otherImageFormat(bytes([0, 0, 1, 0, 1, 0]))).toBe('ico')
    expect(otherImageFormat(bytes('II*', [0]))).toBe('tiff')
    expect(otherImageFormat(bytes('MM', [0, 42]))).toBe('tiff')
    expect(otherImageFormat(ftyp('avif', 'mif1', 'miaf'))).toBe('avif')
    // 主品牌是 mif1、兼容品牌里有 avif 的也是 AVIF
    expect(otherImageFormat(ftyp('mif1', 'avif'))).toBe('avif')
    expect(otherImageFormat(ftyp('heic', 'mif1'))).toBe('heic')
    expect(otherImageFormat(ftyp('mif1', 'heic'))).toBe('heic')
  })
  it('视频（mp4 也是 ftyp）、文本、太短的都不算', () => {
    expect(otherImageFormat(ftyp('isom', 'mp41'))).toBeNull()
    expect(otherImageFormat(bytes('BM'))).toBeNull()
    expect(otherImageFormat(bytes('hello world'))).toBeNull()
  })
  it('按类型或扩展名分到图片附件那边', () => {
    expect(needsConversion(new File([''], 'shot.BMP'))).toBe(true)
    expect(needsConversion(new File([''], 'IMG_0001.HEIC'))).toBe(true)
    expect(needsConversion(new File([''], 'x', { type: 'image/avif' }))).toBe(true)
    expect(needsConversion(new File([''], 'a.png'))).toBe(false)
    expect(isImageFile(new File([''], 'scan.tiff'))).toBe(true)
    expect(isImageFile(new File([''], 'favicon.ico', { type: 'image/x-icon' }))).toBe(true)
  })
})
