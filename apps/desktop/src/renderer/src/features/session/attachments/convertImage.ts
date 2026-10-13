// 不是 PNG / JPEG / WebP / GIF 的图片（docs/ui/composer-file-attachments.md §7.4）：智能体只收这四种。
// BMP、ICO、AVIF 本机（Chromium）能解，添加时转成 PNG；HEIC（苹果手机的照片）、TIFF 这里解不了，说清楚怎么另存
import { MAX_IMAGE_BYTES } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'

export type OtherImage = 'bmp' | 'ico' | 'avif' | 'heic' | 'tiff'

const NAMES: Record<OtherImage, string> = { bmp: 'BMP', ico: 'ICO', avif: 'AVIF', heic: 'HEIC', tiff: 'TIFF' }
const DECODABLE = new Set<OtherImage>(['bmp', 'ico', 'avif'])

/** 按类型或扩展名看像不像要转的图片（拖进来时分到图片附件那边） */
export const CONVERT_TYPES = [
  'image/bmp',
  'image/x-ms-bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
]
const CONVERT_EXT = /\.(bmp|dib|ico|avif|heic|heif|tiff?)$/i
export const needsConversion = (file: File): boolean => CONVERT_TYPES.includes(file.type) || CONVERT_EXT.test(file.name)

/** 按开头的字节认：BM、ICO 的 00 00 01 00、TIFF 的 II* / MM*、ISO 媒体文件 ftyp 里的品牌（avif / heic 一类） */
export function otherImageFormat(b: Uint8Array): OtherImage | null {
  const begins = (...bytes: number[]): boolean => bytes.every((byte, i) => b[i] === byte)
  if (begins(0x42, 0x4d) && b.length > 26) return 'bmp'
  if (begins(0, 0, 1, 0) && b[4] > 0) return 'ico'
  if (begins(0x49, 0x49, 0x2a, 0) || begins(0x4d, 0x4d, 0, 0x2a)) return 'tiff'
  const ascii = (at: number): string => String.fromCharCode(...b.subarray(at, at + 4))
  if (ascii(4) !== 'ftyp') return null
  const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0)
  const brands = [ascii(8)]
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(at))
  if (brands.some(x => x === 'avif' || x === 'avis')) return 'avif'
  if (brands.some(x => /^(heic|heix|heim|heis|hevc|hevx|hevm|hevs|mif1|msf1)$/.test(x))) return 'heic'
  return null
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise(resolve => canvas.toBlob(resolve, type, quality))

/** 转成 PNG（太大时退到 JPEG）；解不了的说怎么另存 */
export async function convertImage(
  file: File,
  format: OtherImage,
): Promise<{ blob: Blob; mediaType: 'image/png' | 'image/jpeg'; width: number; height: number }> {
  const cannot = (): Error => new Error(tr('composer.attachment.cannotDecode', { p0: file.name, p1: NAMES[format] }))
  if (!DECODABLE.has(format)) throw cannot()
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw cannot()
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const png = await canvasBlob(canvas, 'image/png')
    if (png && png.size <= MAX_IMAGE_BYTES)
      return { blob: png, mediaType: 'image/png', width: bitmap.width, height: bitmap.height }
    // 照片类的大图 PNG 会很大：退到 JPEG，透明的地方垫白
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.9)
    if (jpeg && jpeg.size <= MAX_IMAGE_BYTES)
      return { blob: jpeg, mediaType: 'image/jpeg', width: bitmap.width, height: bitmap.height }
    throw new Error(tr('composer.attachment.tooLarge'))
  } finally {
    bitmap.close()
  }
}
