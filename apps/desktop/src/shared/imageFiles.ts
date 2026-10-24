/** 浏览器和工作区查看器都能显示的位图格式。SVG 保留文本编辑和文本差异。 */
export const IMAGE_LIMIT = 8 * 1024 * 1024

const MIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

export function imageMime(path: string): string | undefined {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase()
  return ext && Object.hasOwn(MIME, ext) ? MIME[ext] : undefined
}

/** 按文件开头认上面这些格式（扩展名和内容不一致时以内容为准）；认不出返回 undefined */
export function sniffImage(b: Uint8Array): string | undefined {
  const at = (offset: number, ...bytes: number[]) => bytes.every((x, i) => b[offset + i] === x)
  const ascii = (offset: number, s: string) => at(offset, ...[...s].map(c => c.charCodeAt(0)))
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  // AVIF：ftyp 盒子的主品牌或兼容品牌里有 avif / avis
  if (ascii(4, 'ftyp')) {
    const end = Math.min(b.length, (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3], 64)
    for (let pos = 8; pos + 4 <= end; pos += 4) if (ascii(pos, 'avif') || ascii(pos, 'avis')) return 'image/avif'
  }
  if (ascii(0, 'BM') && b.length > 26) return 'image/bmp'
  if (at(0, 0, 0, 1, 0) && b[4] > 0) return 'image/x-icon'
  return undefined
}
