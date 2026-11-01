// 大字段留在磁盘（docs/session-memory.md）：内存里的条目截掉图片数据，要用时按 id 从磁盘读那一行补回
import type { ImageAttachment, Item } from './types'

/** 有图片数据时返回空掉 dataBase64 的拷贝（其它字段不变），没有返回 undefined */
function emptied(images: ImageAttachment[] | undefined): ImageAttachment[] | undefined {
  if (!images?.some(image => image.dataBase64)) return undefined
  return images.map(image => (image.dataBase64 ? { ...image, dataBase64: '' } : image))
}

/**
 * 截掉条目里的大字段：用户附件、工具图片的 dataBase64 换成 ''，并标 cut: true。
 * 还在跑的、已经截过的、没有图片数据的原样返回（同一个对象）；不改入参
 */
export function cutItem(item: Item): Item {
  if (item.cut || ('status' in item && item.status === 'running')) return item
  if (item.kind === 'user') {
    const attachments = emptied(item.attachments)
    return attachments ? { ...item, attachments, cut: true } : item
  }
  if (item.kind === 'tool') {
    const images = emptied(item.images)
    return images ? { ...item, images, cut: true } : item
  }
  return item
}

/**
 * 用磁盘上的完整条目 full 补回 item 截掉的字段（user 的 attachments、tool 的 images），去掉 cut。
 * 其它字段都取 item：内存里的状态、dismissed、引擎标签等可能比磁盘上的新
 */
export function withBodies(item: Item, full: Item): Item {
  const out: Item = { ...item }
  delete out.cut
  if (out.kind === 'user' && full.kind === 'user') out.attachments = full.attachments
  else if (out.kind === 'tool' && full.kind === 'tool') out.images = full.images
  return out
}
