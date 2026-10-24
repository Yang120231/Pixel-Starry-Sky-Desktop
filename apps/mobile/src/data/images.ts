// 图片（docs/mobile-remote.md §17 第 1 项）
// - 发图：在手机上缩小、转 JPEG，整条消息放得进一帧（1 MB，加密前还要压缩，再留余量）；
// - 看图：会话里的图片被电脑去掉了，点开时向电脑要（网关的 image，太大的电脑先缩小）。
//   取过的和自己发的放在内存里，翻回来不用再取。
import { useCallback, useState } from 'react'
import type { ImageAttachment } from '@pixelsky/protocol'
import { L } from '@/i18n'

/** 一条消息最多几张（和电脑一样） */
export const MAX_IMAGES = 5
/** 一条消息里所有图片加起来的字节上限：base64 后约 850 KB，单帧 1 MB 里还要放文字 */
export const TOTAL_BUDGET = 640 * 1024
/** 依次试的长边和 JPEG 质量：先保清晰（截图上的字），放不下再降 */
const STEPS: readonly (readonly [number, number])[] = [
  [2048, 0.85],
  [2048, 0.72],
  [1600, 0.72],
  [1280, 0.68],
  [1024, 0.62],
  [800, 0.6],
]

/** 长边缩到 maxEdge 以内（不放大），保持比例 */
export function fitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 一共 count 张时每张最多多少字节 */
export const budgetFor = (count: number): number => Math.floor(TOTAL_BUDGET / Math.max(1, count))

/** 文件名换成 .jpg（电脑那边按扩展名显示），太长的截掉 */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, '').slice(0, 100) || 'image'
  return base + '.jpg'
}

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error(L('读不了这张图片', "Couldn't read this image")))
    reader.readAsDataURL(blob)
  })

/** 把一张图缩小成不超过 budget 字节的 JPEG；透明的地方垫白底 */
export async function compressImage(file: File, budget: number): Promise<ImageAttachment> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      L(`「${file.name || '图片'}」打不开，换一张试试`, `Couldn't open “${file.name || 'image'}”. Try another one.`),
    )
  }
  try {
    for (const [edge, quality] of STEPS) {
      const { width, height } = fitSize(bitmap.width, bitmap.height, edge)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const g = canvas.getContext('2d')
      if (!g) throw new Error(L('这台手机不支持压缩图片', "This phone can't compress images"))
      g.fillStyle = '#fff'
      g.fillRect(0, 0, width, height)
      g.drawImage(bitmap, 0, 0, width, height)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality))
      if (!blob || blob.size > budget) continue
      const image: ImageAttachment = {
        id: crypto.randomUUID(),
        name: jpegName(file.name),
        mediaType: 'image/jpeg',
        bytes: blob.size,
        width,
        height,
        dataBase64: await toBase64(blob),
      }
      rememberImage(image.id, imageDataUrl(image))
      return image
    }
  } finally {
    bitmap.close()
  }
  throw new Error(
    L(
      '图片太大，压缩后还是发不了，少选几张试试',
      'Images are too large to send even after compression. Try selecting fewer.',
    ),
  )
}

// ---------------------------------------------------------------------------
// 看图：内存里的缓存（键是图片 id，或「会话/条目/第几张」）
// ---------------------------------------------------------------------------

/** 最多记几张（一张最大约 700 KB 的 base64） */
const CACHE_LIMIT = 24
const cache = new Map<string, string>()

export const imageDataUrl = (image: Pick<ImageAttachment, 'mediaType' | 'dataBase64'>): string =>
  `data:${image.mediaType};base64,${image.dataBase64}`

export function rememberImage(key: string, url: string): void {
  cache.delete(key)
  cache.set(key, url)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

/** 会话里第 index 张图的缓存键 */
export const imageKey = (sessionId: string, itemId: string, index: number): string => `${sessionId}/${itemId}/${index}`

/** 已经有的图：条目里带着数据（查看完整时），或者取过 / 自己发的 */
export function knownImage(image: ImageAttachment, key: string): string | null {
  if (image.dataBase64) return imageDataUrl(image)
  return cache.get(image.id) ?? cache.get(key) ?? null
}

/** 取图失败时给人看的话 */
export function imageError(e: unknown): string {
  const message = (e as Error)?.message ?? String(e)
  if (message.includes('MOBILE_UNSUPPORTED'))
    return L(
      '电脑上的像素星空版本太旧，更新后才能在手机上看图',
      'The PixelSky app on your computer is out of date. Update it to view images on your phone.',
    )
  if (message.includes('MOBILE_TOO_LARGE'))
    return L('图片太大，请到电脑上看', 'Image is too large. View it on the computer.')
  if (message.includes('MOBILE_NOT_FOUND'))
    return L('找不到这张图片（可能已经被清掉）', "Couldn't find this image (it may have been cleared)")
  return message
}

// ---------------------------------------------------------------------------
// 输入框里待发的图片
// ---------------------------------------------------------------------------

export interface PendingImages {
  images: ImageAttachment[]
  busy: boolean
  error: string | null
  add(files: File[]): Promise<void>
  remove(id: string): void
  /** 发出去之后去掉这几张（发送中新加的留着） */
  discard(ids: string[]): void
  clear(): void
}

/** 输入框 / 新建任务里待发的图片：选了就压缩，压完放进来 */
export function usePendingImages(): PendingImages {
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = useCallback(
    async (files: File[]) => {
      setError(null)
      const room = MAX_IMAGES - images.length
      if (room <= 0) return setError(L(`一条消息最多 ${MAX_IMAGES} 张图片`, `Up to ${MAX_IMAGES} images per message`))
      const chosen = files.filter(f => f.type.startsWith('image/') || !f.type).slice(0, room)
      if (files.length > room)
        setError(
          L(
            `一条消息最多 ${MAX_IMAGES} 张图片，多出来的没有加`,
            `Up to ${MAX_IMAGES} images per message. The extra ones weren't added.`,
          ),
        )
      if (!chosen.length) return
      setBusy(true)
      try {
        // 已有的图按当时的预算压过了；新加的按加上之后的总张数分预算，总量仍不超过上限
        const used = images.reduce((n, i) => n + i.bytes, 0)
        const each = Math.min(
          budgetFor(images.length + chosen.length),
          Math.floor((TOTAL_BUDGET - used) / chosen.length),
        )
        if (each < 40 * 1024)
          throw new Error(L('图片放不下了，先删掉几张再加', 'No room for more images. Remove some first.'))
        const done: ImageAttachment[] = []
        for (const file of chosen) done.push(await compressImage(file, each))
        setImages(list => [...list, ...done])
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [images],
  )
  const remove = useCallback((id: string) => setImages(list => list.filter(i => i.id !== id)), [])
  const discard = useCallback((ids: string[]) => {
    setImages(list => list.filter(i => !ids.includes(i.id)))
    setError(null)
  }, [])
  const clear = useCallback(() => {
    setImages([])
    setError(null)
  }, [])
  return { images, busy, error, add, remove, discard, clear }
}
