import type { ImageAttachment } from './types'

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_TOTAL = 20 * 1024 * 1024
export const MAX_IMAGE_COUNT = 5

/** 工具结果里图片在文字输出中的占位（纯文本里也看得出这里有图；图片本身另放在 images） */
export const IMAGE_PLACEHOLDER = '[图片]'

/** 界面显示用：已经作为图片显示出来的那几张，去掉它们在文字输出里的占位行；剩下没内容就返回空串 */
export function withoutShownImagePlaceholders(output: string, shown: number): string {
  if (!output || shown <= 0) return output
  let left = shown
  const rest = output
    .split('\n')
    .filter(line => {
      if (left > 0 && line.trim() === IMAGE_PLACEHOLDER) {
        left--
        return false
      }
      return true
    })
    .join('\n')
  return rest.trim() ? rest : ''
}

export function imageMediaType(data: Uint8Array): ImageAttachment['mediaType'] | null {
  const begins = (...bytes: number[]): boolean => bytes.every((byte, i) => data[i] === byte)
  if (begins(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png'
  if (begins(255, 216, 255)) return 'image/jpeg'
  if (begins(71, 73, 70, 56) && (data[4] === 55 || data[4] === 57) && data[5] === 97) return 'image/gif'
  if (begins(82, 73, 70, 70) && [87, 69, 66, 80].every((byte, i) => data[8 + i] === byte)) return 'image/webp'
  return null
}

/** 共用校验：在草稿恢复、IPC 入队和实际派发时再次检查，限制分配量。 */
export function validateImages(value: unknown): ImageAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('图片附件格式不正确')
  if (value.length > MAX_IMAGE_COUNT) throw new Error('一条消息最多添加 5 张图片')
  let total = 0
  const ids = new Set<string>()
  return value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('图片附件格式不正确')
    const image = raw as ImageAttachment
    if (
      typeof image.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(image.id) ||
      ids.has(image.id) ||
      typeof image.name !== 'string' ||
      !image.name ||
      image.name.length > 512 ||
      !IMAGE_MEDIA_TYPES.includes(image.mediaType)
    )
      throw new Error('图片附件格式不正确')
    if (!Number.isInteger(image.bytes) || image.bytes <= 0 || image.bytes > MAX_IMAGE_BYTES)
      throw new Error('图片过大，单张不能超过 10 MiB')
    total += image.bytes
    if (total > MAX_IMAGE_TOTAL) throw new Error('图片总大小不能超过 20 MiB')
    if (
      !Number.isInteger(image.width) ||
      image.width <= 0 ||
      image.width > 100_000 ||
      !Number.isInteger(image.height) ||
      image.height <= 0 ||
      image.height > 100_000
    )
      throw new Error('图片尺寸不正确')
    const base64 = image.dataBase64,
      alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    if (typeof base64 !== 'string' || base64.length !== Math.ceil(image.bytes / 3) * 4)
      throw new Error('图片数据不正确')
    const padding = image.bytes % 3 === 0 ? 0 : 3 - (image.bytes % 3)
    for (let i = 0; i < base64.length; i++) {
      if (i >= base64.length - padding ? base64[i] !== '=' : alphabet.indexOf(base64[i]) < 0)
        throw new Error('图片数据不正确')
    }
    const last = alphabet.indexOf(base64[base64.length - padding - 1])
    if ((padding === 1 && last % 4 !== 0) || (padding === 2 && last % 16 !== 0)) throw new Error('图片数据不正确')
    const prefix: number[] = []
    let accumulator = 0,
      bits = 0
    for (const char of base64.slice(0, 16)) {
      const v = alphabet.indexOf(char)
      if (v < 0) break
      accumulator = (accumulator << 6) | v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        prefix.push((accumulator >> bits) & 255)
      }
    }
    if (imageMediaType(new Uint8Array(prefix)) !== image.mediaType) throw new Error('图片类型与内容不符')
    ids.add(image.id)
    return {
      id: image.id,
      name: image.name,
      mediaType: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      dataBase64: image.dataBase64,
    }
  })
}
