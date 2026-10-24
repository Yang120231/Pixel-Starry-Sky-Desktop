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
