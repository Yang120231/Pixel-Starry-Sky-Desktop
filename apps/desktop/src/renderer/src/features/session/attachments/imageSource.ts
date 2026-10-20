// 对话里的图片按需取原图（docs/perf-audit-2026-10-18.md B1）：桌面界面的快照和事件里图片不带数据（只有名字、大小、宽高），
// 显示、复制、重发时按 会话 + 条目 + 图片 id 向主进程要，只留最近几张，界面不再常驻全部原图
import { createContext } from 'react'
import type { ImageAttachment } from '@pixelsky/protocol'
import { isDemo } from '@/data'

/** 正在显示的会话 id（SessionView 提供）；没有时图片只能用自带的数据 */
export const ImageSessionContext = createContext<string | null>(null)

const recent = new Map<string, ImageAttachment>()
const RECENT_LIMIT = 8
const loading = new Map<string, Promise<ImageAttachment | null>>()

/** 带数据的原图：自带数据就直接用；否则按需取（同一张同时只取一次），取不到为 null */
export function fullImage(
  image: ImageAttachment,
  sessionId: string | null | undefined,
  itemId: string | null | undefined,
): Promise<ImageAttachment | null> {
  if (image.dataBase64) return Promise.resolve(image)
  const bridge = isDemo ? undefined : window.pixelsky?.engine
  if (!sessionId || !itemId || !bridge) return Promise.resolve(null)
  const key = `${sessionId}|${itemId}|${image.id}`
  const hit = recent.get(key)
  if (hit) {
    recent.delete(key)
    recent.set(key, hit)
    return Promise.resolve(hit)
  }
  const running = loading.get(key)
  if (running) return running
  const job = bridge
    .image(sessionId, itemId, image.id)
    .then(full => {
      if (!full?.dataBase64) return null
      recent.set(key, full)
      while (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value!)
      return full
    })
    .catch(() => null)
    .finally(() => loading.delete(key))
  loading.set(key, job)
  return job
}

/** 一组图都换成带数据的（重发、交给引擎前用）；取不到的去掉 */
export async function fullImages(
  images: readonly ImageAttachment[],
  sessionId: string | null | undefined,
  itemId: string | null | undefined,
): Promise<ImageAttachment[]> {
  const list = await Promise.all(images.map(image => fullImage(image, sessionId, itemId)))
  return list.filter((image): image is ImageAttachment => !!image)
}
