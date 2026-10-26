// 解压 Office / OpenDocument / EPUB 这类 zip 包：只解出要用的那几个文件。
// 用同步解压：fflate 的异步解压遇到 512KB 以上的文件会起 blob: Worker，界面的 CSP 不许，Worker 被静默拦下、回调永远不来（长 Word 一直「正在读取附件」）。
// 只解 XML、合计又有上限，20MB 也就几十毫秒
import { unzipSync, type Unzipped } from 'fflate'

export class ZipEntries {
  constructor(
    private readonly files: Unzipped,
    /** 包里所有文件的路径（没解出来的也算，文件夹不算），按包里的顺序 */
    readonly all: string[] = Object.keys(files),
  ) {}
  has(path: string): boolean {
    return path in this.files
  }
  /** 读成文字（UTF-8，去掉 BOM）；没有这个文件时 null */
  text(path: string): string | null {
    const bytes = this.files[path]
    if (!bytes) return null
    const text = new TextDecoder('utf-8').decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  }
}

/** 要解出来的文件解压后合计不能超过这么多：压缩比极高的包（zip 炸弹）会把界面撑爆 */
export const MAX_UNZIPPED_BYTES = 256 * 1024 * 1024

export class UnzipTooLarge extends Error {}

/** 解压：pick 决定要哪些文件（不解出图片、字体这些用不上的大块）；按包里写的原始大小先算合计，超了不解 */
export async function unzipEntries(bytes: Uint8Array, pick: (name: string) => boolean): Promise<ZipEntries> {
  const all: string[] = []
  let total = 0,
    tooLarge = false
  const files = unzipSync(bytes, {
    // 每个文件解压前先过这里（原始大小来自包里的目录）：超了的那个和后面的都不解
    filter: f => {
      if (!f.name.endsWith('/')) all.push(f.name)
      if (tooLarge || !pick(f.name)) return false
      total += f.originalSize
      if (total > MAX_UNZIPPED_BYTES) tooLarge = true
      return !tooLarge
    },
  })
  if (tooLarge) throw new UnzipTooLarge()
  return new ZipEntries(files, all)
}

/** zip 包里的路径：rels 里的相对路径（../slides/slide1.xml）按所在目录拼出来 */
export function joinPath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = dir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
