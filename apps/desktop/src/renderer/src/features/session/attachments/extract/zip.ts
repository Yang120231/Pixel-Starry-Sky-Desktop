// 解压 Office / OpenDocument / EPUB 这类 zip 包：只解出要用的那几个文件（fflate 的异步解压在后台线程里做）
import { unzip, type Unzipped } from 'fflate'

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

/** 解压：pick 决定要哪些文件（不解出图片、字体这些用不上的大块） */
export function unzipEntries(bytes: Uint8Array, pick: (name: string) => boolean): Promise<ZipEntries> {
  const all: string[] = []
  return new Promise((resolve, reject) =>
    unzip(
      bytes,
      {
        filter: f => {
          if (!f.name.endsWith('/')) all.push(f.name)
          return pick(f.name)
        },
      },
      (error, files) => (error ? reject(error) : resolve(new ZipEntries(files, all))),
    ),
  )
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
