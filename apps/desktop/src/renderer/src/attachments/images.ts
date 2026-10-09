import { imageMediaType, MAX_IMAGE_BYTES, type ImageAttachment } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'

export async function readImage(file: File): Promise<ImageAttachment> {
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error(tr('composer.attachment.tooLarge'))
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer), mediaType = imageMediaType(bytes)
  if (!mediaType) throw new Error(tr('composer.attachment.invalidType'))
  const blob = new Blob([buffer], { type: mediaType }), url = URL.createObjectURL(blob)
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error(tr('composer.attachment.readError')))
      image.src = url
    })
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error(tr('composer.attachment.readError')))
      reader.readAsDataURL(blob)
    })
    return { id: crypto.randomUUID(), name: file.name || 'image', mediaType, bytes: file.size, ...dimensions, dataBase64 }
  } finally { URL.revokeObjectURL(url) }
}
export function imageBlob(image: ImageAttachment): Blob {
  return new Blob([Uint8Array.from(atob(image.dataBase64), c => c.charCodeAt(0))], { type: image.mediaType })
}
export function imageSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`
}
