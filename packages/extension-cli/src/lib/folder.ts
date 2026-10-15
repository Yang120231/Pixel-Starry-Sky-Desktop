import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { EXT_LIMITS, extPackSkipped } from '@pixelsky/protocol/extpacks'
import type { ExtPackFileEntry, ExtPackFiles } from '@pixelsky/protocol/extpacks'

export const FOLDER_SCAN = { limitFiles: EXT_LIMITS.scanFiles, limitBytes: EXT_LIMITS.scanBytes }

const byPath = (a: ExtPackFileEntry, b: ExtPackFileEntry): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * 从桌面 loader.ts 搬来：不跟符号链接，套用 extPackSkipped（被略过的目录不进入）。
 * skipped 记录最外层被略过的项：目录写成 "路径/"，文件写成 "路径"。
 * 超出上限就停并标 truncated（字节数先加再比，和原来一致）。
 */
export async function walkPack(
  root: string,
  limits: { limitFiles: number; limitBytes: number },
): Promise<{ entries: ExtPackFileEntry[]; truncated: boolean; skipped: string[] }> {
  const entries: ExtPackFileEntry[] = []
  const skipped: string[] = []
  let bytes = 0
  let truncated = false
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let items
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const item of items) {
      if (truncated) return
      const rel = prefix ? `${prefix}/${item.name}` : item.name
      if (item.isSymbolicLink()) {
        if (extPackSkipped(rel, 'symlink')) skipped.push(rel)
        else entries.push({ path: rel, size: 0, kind: 'symlink' })
      } else if (item.isDirectory()) {
        if (extPackSkipped(rel, 'dir')) skipped.push(`${rel}/`)
        else await visit(join(dir, item.name), rel)
      } else if (item.isFile()) {
        if (extPackSkipped(rel, 'file')) {
          skipped.push(rel)
          continue
        }
        let size: number
        try {
          size = (await lstat(join(dir, item.name))).size
        } catch {
          continue
        }
        bytes += size
        if (entries.length >= limits.limitFiles || bytes > limits.limitBytes) {
          truncated = true
          return
        }
        entries.push({ path: rel, size, kind: 'file' })
      }
    }
  }
  await visit(root, '')
  entries.sort(byPath)
  return { entries, truncated, skipped }
}

/** 相对路径是否安全：不含反斜杠 / NUL，不是绝对路径（含盘符），没有空段 / "." / ".." 段 */
function safeRel(path: string): boolean {
  if (!path || path.includes('\\') || path.includes('\0')) return false
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

/** 文件夹 → ExtPackFiles；stat / read 用 lstat 且要求普通文件（符号链接算不存在） */
export async function folderPackFiles(
  root: string,
  limits: { limitFiles: number; limitBytes: number } = FOLDER_SCAN,
): Promise<ExtPackFiles & { skipped: string[] }> {
  let walked: Awaited<ReturnType<typeof walkPack>>
  try {
    walked = await walkPack(root, limits)
  } catch {
    walked = { entries: [], truncated: false, skipped: [] }
  }
  // stat / read 只认遍历得到的原样路径：Windows / macOS 的 lstat 不分大小写，不卡住的话
  // Pixelsky-Extension.json 会在这两个平台被当成清单，换到 Linux 就是 manifest.missing
  const known = new Set(walked.entries.map(e => e.path))
  // 扫描被截断时 entries 不全：没列出的路径改成逐段核对磁盘上的名字是否一字不差
  const exact = (path: string): boolean => {
    if (known.has(path)) return true
    if (!walked.truncated) return false
    let dir = root
    try {
      for (const seg of path.split('/')) {
        if (!readdirSync(dir).includes(seg)) return false
        dir = join(dir, seg)
      }
      return true
    } catch {
      return false
    }
  }
  return {
    entries: walked.entries,
    truncated: walked.truncated,
    skipped: walked.skipped,
    stat(path) {
      if (!safeRel(path) || !exact(path)) return null
      try {
        const st = lstatSync(join(root, path))
        return st.isFile() ? st.size : null
      } catch {
        return null
      }
    },
    read(path, maxBytes) {
      if (!safeRel(path) || !exact(path)) return null
      const file = join(root, path)
      let fd: number | null = null
      try {
        if (!lstatSync(file).isFile()) return null
        fd = openSync(file, 'r')
        const st = fstatSync(fd)
        if (!st.isFile()) return null
        const size = Math.max(0, Math.min(st.size, maxBytes))
        const buf = new Uint8Array(size)
        let got = 0
        while (got < size) {
          const n = readSync(fd, buf, got, size - got, got)
          if (n <= 0) break
          got += n
        }
        return got === size ? buf : buf.subarray(0, got)
      } catch {
        return null
      } finally {
        if (fd !== null) closeSync(fd)
      }
    },
  }
}
