import { zipSync } from 'fflate'
import type { ZipOptions } from 'fflate'
import type { ExtPackFiles } from '@pixelsky/protocol/extpacks'

/** 本地时区构造 1980-01-01 00:00:00：DOS 时间字段在任何时区里都一样 */
const FIXED_MTIME = new Date(1980, 0, 1)

/** 确定性打包：同样的输入逐字节相同（plan §4.3）。路径按 UTF-16 排序，只写文件，不写目录条目 */
export function writePackZip(src: ExtPackFiles, paths: readonly string[]): Uint8Array {
  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const files: Record<string, [Uint8Array, ZipOptions]> = Object.create(null)
  // fflate 内部也用普通对象，名字是 __proto__ 时会丢条目：先用等长占位名，写完再把名字字节换回来
  let placeholder: string | null = null
  if (sorted.includes(PROTO)) {
    for (let i = 0; i < 10 && !placeholder; i++) if (!sorted.includes(`__proto${i}_`)) placeholder = `__proto${i}_`
    if (!placeholder) throw new Error('无法为 __proto__ 选占位名')
  }
  for (const path of sorted) {
    const data = src.read(path, Number.MAX_SAFE_INTEGER)
    if (!data) throw new Error(`读不到要打包的文件：${path}`)
    files[path === PROTO && placeholder ? placeholder : path] = [
      data,
      { level: /\.png$/i.test(path) ? 0 : 9, mtime: FIXED_MTIME, os: 0, attrs: 0 },
    ]
  }
  const zip = zipSync(files)
  if (placeholder) renameBytes(zip, placeholder, PROTO)
  ensureUtf8Flag(zip, sorted)
  return zip
}

const PROTO = '__proto__'

/** 把名字等于 from 的条目（只改本地头 + 中央头里的名字字节，不碰数据）换成等长的 to */
function renameBytes(zip: Uint8Array, from: string, to: string): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = zip.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--
  if (eocd < 0) return
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const named = (at: number, len: number): boolean =>
    len === from.length && [...from].every((c, k) => zip[at + k] === c.charCodeAt(0))
  const write = (at: number): void => {
    for (let k = 0; k < to.length; k++) zip[at + k] = to.charCodeAt(k)
  }
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(p + 28, true)
    if (named(p + 46, nameLen)) {
      write(p + 46)
      write(view.getUint32(p + 42, true) + 30)
    }
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
  }
}

/** 非 ASCII 的名字必须带通用标志位 11（UTF-8）；fflate 已经会设，这里兜底并补到本地头和中央头 */
function ensureUtf8Flag(zip: Uint8Array, paths: readonly string[]): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const wanted = new Set(paths.filter(p => /[\u0080-￿]/.test(p)))
  if (wanted.size === 0) return
  const dec = new TextDecoder('utf-8', { ignoreBOM: true })
  // 找 EOCD，遍历中央目录；每个中央头补标志，并顺着本地头偏移补本地头
  let eocd = zip.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--
  if (eocd < 0) return
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(p + 28, true)
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen))
    if (wanted.has(name)) {
      view.setUint16(p + 8, view.getUint16(p + 8, true) | 0x800, true)
      const lo = view.getUint32(p + 42, true)
      view.setUint16(lo + 6, view.getUint16(lo + 6, true) | 0x800, true)
    }
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
  }
}
