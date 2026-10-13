// 图片缩小：手机看大图（mobile/ipc.ts）和反馈截图（feedback/）共用
import { nativeImage } from 'electron'
import type { ImageAttachment } from '@pixelsky/protocol'

/** 缩小到长边 maxEdge 以内、转成 JPEG（docs/mobile-remote.md §17）；解不开返回 null */
export function shrinkImage(image: ImageAttachment, maxEdge: number): ImageAttachment | null {
  const source = nativeImage.createFromBuffer(Buffer.from(image.dataBase64, 'base64'))
  if (source.isEmpty()) return null
  const { width, height } = source.getSize()
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const out =
    scale < 1
      ? source.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' })
      : source
  const jpeg = out.toJPEG(82)
  const size = out.getSize()
  return {
    ...image,
    name: image.name.replace(/.[^.]*$/, '') + '.jpg',
    mediaType: 'image/jpeg',
    bytes: jpeg.length,
    width: size.width,
    height: size.height,
    dataBase64: jpeg.toString('base64'),
  }
}
