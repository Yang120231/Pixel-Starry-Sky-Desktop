import { Inflate } from 'fflate'
import { EXT_LIMITS, zipIssue } from '@pixelsky/protocol/extpacks'
import type { ExtPackFileEntry, ExtPackFiles, ExtPackIssue } from '@pixelsky/protocol/extpacks'
import { crc32 } from './crc32'

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_MIN = 22
const EOCD_SCAN = 65_557
const MANIFEST = 'pixelsky-extension.json'
/** 每次喂给 inflate 的压缩字节数：单次最多展开约 1032 倍，这样超出声明大小时能及早停下 */
const INFLATE_SLICE = 16 * 1024

interface ZipEntry {
  path: string
  method: number
  crc: number
  csize: number
  usize: number
  localOffset: number
  symlink: boolean
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

class ZipInvalid extends Error {}

/** 在内存里解析 zip，不碰磁盘；zip 层的发现放在 preIssues（plan §4.3） */
export function readPackZip(bytes: Uint8Array): ExtPackFiles {
  const preIssues: ExtPackIssue[] = []
  const fail = (issue: ExtPackIssue): ExtPackFiles => ({
    entries: [],
    truncated: false,
    stat: () => null,
    read: () => null,
    preIssues: [issue, ...preIssues],
  })

  if (bytes.length > EXT_LIMITS.packBytes) {
    return fail(zipIssue('zip.tooLarge', { detail: `${bytes.length}` }))
  }

  let parsed: ZipEntry[]
  try {
    parsed = parseCentral(bytes, preIssues)
  } catch (e) {
    if (e instanceof ZipInvalid) return fail(zipIssue('zip.invalid', { detail: e.message }))
    throw e
  }

  // 防炸弹：先按声明的大小套用扫描上限，超了就只列到上限（和文件夹遍历一样，字节数先加再比）
  parsed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const kept: ZipEntry[] = []
  const entries: ExtPackFileEntry[] = []
  let total = 0
  let truncated = false
  for (const z of parsed) {
    total += z.usize
    if (kept.length >= EXT_LIMITS.scanFiles || total > EXT_LIMITS.scanBytes) {
      truncated = true
      break
    }
    kept.push(z)
    entries.push({ path: z.path, size: z.symlink ? 0 : z.usize, kind: z.symlink ? 'symlink' : 'file' })
  }

  const byPath = new Map<string, ZipEntry>()
  for (const z of parsed) if (!z.symlink) byPath.set(z.path, z)

  const cache = new Map<string, Uint8Array | null>()
  const corrupt = new Set<string>()
  const verify = (z: ZipEntry): Uint8Array | null => {
    if (cache.has(z.path)) return cache.get(z.path)!
    let out: Uint8Array | null
    try {
      out = extract(bytes, z)
    } catch {
      out = null
    }
    if (!out && !corrupt.has(z.path)) {
      corrupt.add(z.path)
      preIssues.push(zipIssue('zip.corrupt', { path: z.path }))
    }
    cache.set(z.path, out)
    return out
  }

  // 没截断时一次性验完所有不大于 fileBytes 的条目，让损坏在 checkPack 之前就进 preIssues
  if (!truncated) for (const z of kept) if (!z.symlink && z.usize <= EXT_LIMITS.fileBytes) verify(z)

  // 套了一层文件夹：清单不在根上，却在唯一的第一层目录里
  if (!kept.some(z => z.path === MANIFEST)) {
    const first = new Set(kept.map(z => z.path.split('/')[0]))
    if (kept.length > 0 && first.size === 1) {
      const dir = `${[...first][0]}/`
      if (kept.some(z => z.path === `${dir}${MANIFEST}`)) preIssues.push(zipIssue('zip.nested', { dir }))
    }
  }

  return {
    entries,
    truncated,
    preIssues,
    stat(path) {
      const z = byPath.get(path)
      return z ? z.usize : null
    },
    read(path, maxBytes) {
      const z = byPath.get(path)
      if (!z || z.usize > EXT_LIMITS.fileBytes) return null
      const data = verify(z)
      return data ? data.subarray(0, Math.max(0, maxBytes)) : null
    },
  }
}

function parseCentral(bytes: Uint8Array, preIssues: ExtPackIssue[]): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const len = bytes.length

  // 从尾部往前找 EOCD，并要求它的注释长度刚好落在文件末尾
  let eocd = -1
  for (let i = len - EOCD_MIN; i >= Math.max(0, len - EOCD_SCAN); i--) {
    if (view.getUint32(i, true) === SIG_EOCD && i + EOCD_MIN + view.getUint16(i + 20, true) <= len) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipInvalid('找不到 zip 目录结尾')

  const diskNo = view.getUint16(eocd + 4, true)
  const cdDisk = view.getUint16(eocd + 6, true)
  const countHere = view.getUint16(eocd + 8, true)
  const count = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (
    diskNo !== 0 ||
    cdDisk !== 0 ||
    countHere !== count ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  )
    throw new ZipInvalid('zip64 / 分卷')
  if (cdOffset + cdSize > eocd) throw new ZipInvalid('中央目录越界')

  const out: ZipEntry[] = []
  const seen = new Set<string>()
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (p + 46 > cdOffset + cdSize || view.getUint32(p, true) !== SIG_CENTRAL) throw new ZipInvalid('中央目录条目损坏')
    const madeBy = view.getUint16(p + 4, true)
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const csize = view.getUint32(p + 20, true)
    const usize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const extAttr = view.getUint32(p + 38, true)
    const localOffset = view.getUint32(p + 42, true)
    const next = p + 46 + nameLen + extraLen + commentLen
    if (next > cdOffset + cdSize) throw new ZipInvalid('中央目录条目越界')
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen)
    p = next

    // 名字
    let name: string
    const hasHigh = rawName.some(b => b >= 0x80)
    if (hasHigh && !(flags & 0x800)) {
      preIssues.push(zipIssue('zip.nameEncoding', { detail: '没有 UTF-8 标志' }))
      continue
    }
    try {
      name = utf8.decode(rawName)
    } catch {
      preIssues.push(zipIssue('zip.nameEncoding', { detail: '名字不是合法的 UTF-8' }))
      continue
    }
    if (name.endsWith('/')) continue // 目录条目直接忽略
    if (!safeName(name)) {
      preIssues.push(zipIssue('zip.entryName', { path: name }))
      continue
    }
    if (seen.has(name)) {
      preIssues.push(zipIssue('zip.duplicate', { path: name }))
      continue
    }
    seen.add(name)
    if (flags & 0x1) {
      preIssues.push(zipIssue('zip.unsupported', { path: name, detail: '加密' }))
      continue
    }
    if (method !== 0 && method !== 8) {
      preIssues.push(zipIssue('zip.unsupported', { path: name, detail: `压缩方式 ${method}` }))
      continue
    }
    const symlink = madeBy >> 8 === 3 && ((extAttr >>> 16) & 0o170000) === 0o120000
    out.push({ path: name, method, crc, csize, usize, localOffset, symlink })
  }
  return out
}

/** 条目名是否安全：非空，不是绝对路径 / 盘符，没有反斜杠 / 控制字符，没有空段 / "." / ".." 段 */
function safeName(name: string): boolean {
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\')) return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return name.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

/** 读出一个条目的完整内容并核对长度和 CRC；任何不符都抛错 */
function extract(bytes: Uint8Array, z: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lo = z.localOffset
  if (lo + 30 > bytes.length || view.getUint32(lo, true) !== SIG_LOCAL) throw new Error('local header')
  const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true)
  const end = start + z.csize
  if (end > bytes.length) throw new Error('data overrun')
  const data = bytes.subarray(start, end)
  let out: Uint8Array
  if (z.method === 0) {
    if (z.csize !== z.usize) throw new Error('stored size')
    out = data
  } else {
    out = inflateBounded(data, z.usize)
  }
  if (out.length !== z.usize) throw new Error('length')
  if (crc32(out) !== z.crc) throw new Error('crc')
  return out
}

/** 分片喂 inflate，输出一超过声明大小就抛错，避免声明很小、实际很大的炸弹 */
function inflateBounded(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  let got = 0
  const inf = new Inflate(chunk => {
    if (got + chunk.length > expected) throw new Error('overflow')
    out.set(chunk, got)
    got += chunk.length
  })
  if (data.length === 0) {
    if (expected === 0) return out
    throw new Error('empty')
  }
  for (let i = 0; i < data.length; i += INFLATE_SLICE) {
    const slice = data.subarray(i, Math.min(data.length, i + INFLATE_SLICE))
    inf.push(slice, i + INFLATE_SLICE >= data.length)
  }
  return got === expected ? out : out.subarray(0, got)
}
