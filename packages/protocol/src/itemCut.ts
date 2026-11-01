// 大字段留在磁盘（docs/session-memory.md）：内存里的条目截掉图片数据、长输出只留头尾，要用时按 id 从磁盘读那一行补回
import type { ImageAttachment, Item } from './types'

/** 命令 / 工具的 output 超过这么多字符才截 */
export const CUT_OVER = 8192
/** 截过的 output 留前后各这么多字符（边界落在代理对中间时少留一个） */
export const CUT_EDGE = 2048

/** 有图片数据时返回空掉 dataBase64 的拷贝（其它字段不变），没有返回 undefined */
function emptied(images: ImageAttachment[] | undefined): ImageAttachment[] | undefined {
  if (!images?.some(image => image.dataBase64)) return undefined
  return images.map(image => (image.dataBase64 ? { ...image, dataBase64: '' } : image))
}

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/** 前 CUT_EDGE + 一行省略说明 + 后 CUT_EDGE，不劈开代理对 */
function headTail(text: string): string {
  const head = isHigh(text.charCodeAt(CUT_EDGE - 1)) ? CUT_EDGE - 1 : CUT_EDGE
  const tail = isLow(text.charCodeAt(text.length - CUT_EDGE)) ? text.length - CUT_EDGE + 1 : text.length - CUT_EDGE
  const out = `${text.slice(0, head)}\n…（中间省略 ${tail - head} 个字符）…\n${text.slice(tail)}`
  // 拷成扁平的新串：V8 的切片、拼接串引用着整个原串，不拷整串还留在内存里
  return JSON.parse(JSON.stringify(out)) as string
}

/**
 * 截掉条目里的大字段，标 cut: true：用户附件、工具图片的 dataBase64 换成 ''；命令 / 工具的 output 超过 CUT_OVER 时
 * 只留头尾（headTail），原长度记在 cutChars。还在跑的（流式增量要接在完整的上）、已经截过的、没有大字段的原样返回（同一个对象）；不改入参
 */
export function cutItem(item: Item): Item {
  if (item.cut || ('status' in item && item.status === 'running')) return item
  if (item.kind === 'user') {
    const attachments = emptied(item.attachments)
    return attachments ? { ...item, attachments, cut: true } : item
  }
  if (item.kind !== 'command' && item.kind !== 'tool') return item
  const images = item.kind === 'tool' ? emptied(item.images) : undefined
  const long = item.output.length > CUT_OVER
  if (!images && !long) return item
  return {
    ...item,
    ...(images && { images }),
    ...(long && { output: headTail(item.output), cutChars: item.output.length }),
    cut: true,
  }
}

/**
 * 用磁盘上的完整条目 full 补回 item 截掉的字段（user 的 attachments、tool 的 images、截过的 output），去掉 cut、cutChars。
 * 其它字段都取 item：内存里的状态、dismissed、引擎标签等可能比磁盘上的新
 */
export function withBodies(item: Item, full: Item): Item {
  const out: Item = { ...item }
  delete out.cut
  delete out.cutChars
  if (out.kind === 'user' && full.kind === 'user') out.attachments = full.attachments
  // 只截了 output 的工具，内存里的图片可能是后补的（Codex 的 restoreItem），磁盘上还没有
  else if (out.kind === 'tool' && full.kind === 'tool' && out.images?.some(image => !image.dataBase64))
    out.images = full.images
  if (item.cutChars !== undefined && (out.kind === 'command' || out.kind === 'tool') && 'output' in full)
    out.output = full.output
  return out
}
