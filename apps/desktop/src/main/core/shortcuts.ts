// Windows 快捷方式（.lnk，MS-SHLLINK 格式）指着的程序：编辑器检测靠它找装在别处的程序，不查注册表、不开进程
// （开进程在主线程上同步做，被安全软件拖慢时整个应用卡住，docs/ui/open-with.md）
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, win32 } from 'node:path'

const HEADER_SIZE = 0x4c
/** LinkCLSID 00021401-0000-0000-C000-000000000046 按文件里的字节顺序 */
const CLSID = '0114020000000000c000000000000046'
const HAS_ID_LIST = 1 << 0
const HAS_LINK_INFO = 1 << 1
const HAS_NAME = 1 << 2
const HAS_RELATIVE_PATH = 1 << 3
const HAS_WORKING_DIR = 1 << 4
const HAS_ARGUMENTS = 1 << 5
const HAS_ICON_LOCATION = 1 << 6
const IS_UNICODE = 1 << 7
const FORCE_NO_LINK_INFO = 1 << 8
const HAS_EXP_STRING = 1 << 9
/** MSI「播发」的快捷方式：只有产品代码，没有路径 */
const HAS_DARWIN_ID = 1 << 12
const ENVIRONMENT_BLOCK = 0xa0000001
/** ANSI 路径不知道是哪个代码页：几种常见的都解一遍，哪个存在用哪个 */
const CODE_PAGES = ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1251', 'windows-1252']

const ascii = (bytes: Buffer): boolean => bytes.every(b => b < 0x80)

/** 以 0 结尾的单字节字符串 */
function cstr(b: Buffer, at: number, max = b.length - at): Buffer {
  const end = b.indexOf(0, at)
  return b.subarray(at, end < 0 || end > at + max ? Math.min(b.length, at + max) : end)
}

/** 以 0 结尾的 UTF-16 字符串 */
function cstr16(b: Buffer, at: number, max = b.length - at): string {
  let end = at
  while (end + 1 < b.length && end - at < max && (b[end] || b[end + 1])) end += 2
  return b.toString('utf16le', at, end)
}

/** 单字节路径：全是 ASCII 直接用，不然按几种代码页各解一遍 */
function decodings(bytes: Buffer): string[] {
  if (!bytes.length) return []
  if (ascii(bytes)) return [bytes.toString('latin1')]
  const out = new Set<string>()
  for (const page of CODE_PAGES)
    try {
      out.add(new TextDecoder(page, { fatal: true }).decode(bytes))
    } catch {
      // 不是这个代码页
    }
  return [...out]
}

const MY_COMPUTER = 'e04fd020ea3a6910a2d808002b30309d'
const LONG_NAME = Buffer.from([0x04, 0x00, 0xef, 0xbe])

/** 文件夹 / 文件项的名字：扩展块 0xBEEF0004 里的长文件名，没有时用项里的主名字（可能是 8.3 短名，Windows 也认） */
function entryName(item: Buffer): string | null {
  const sig = item.indexOf(LONG_NAME)
  if (sig >= 4) {
    const start = sig - 4,
      version = item.readUInt16LE(start + 2)
    // 长文件名的位置随版本变：v3 在 20，v7 在 38，v8 在 42，v9 在 46
    const at = version >= 9 ? 46 : version === 8 ? 42 : version === 7 ? 38 : version >= 3 ? 20 : -1
    if (at > 0 && start + at < item.length) {
      const name = cstr16(item, start + at)
      if (name) return name
    }
  }
  if (item[2] & 0x04) return cstr16(item, 14) || null
  const primary = cstr(item, 14)
  return primary.length && ascii(primary) ? primary.toString('latin1') : null
}

/** 目标的 ID 列表里的本地路径：只认「此电脑 → 盘符 → 文件夹 … → 文件」这一种，别的（网络、虚拟文件夹）不要 */
function idListPath(b: Buffer): string | null {
  let at = 0,
    path = ''
  while (at + 3 <= b.length) {
    const size = b.readUInt16LE(at)
    if (size < 3 || at + size > b.length) break
    const item = b.subarray(at, at + size),
      type = item[2]
    if (type === 0x1f) {
      if (at !== 0 || item.toString('hex', 4, 20) !== MY_COMPUTER) return null
    } else if ((type & 0x70) === 0x20) {
      const drive = cstr(item, 3).toString('latin1')
      if (!/^[A-Za-z]:\\?$/.test(drive)) return null
      path = drive.endsWith('\\') ? drive : drive + '\\'
    } else if ((type & 0x70) === 0x30) {
      const name = entryName(item)
      if (!name || !path || /[\\/]/.test(name)) return null
      path = win32.join(path, name)
    } else return null
    at += size
  }
  return path || null
}

/** LinkInfo 里的本地路径（网络路径不要）：Unicode 的优先 */
function linkInfoPaths(b: Buffer): string[] {
  if (b.length < 28) return []
  const headerSize = b.readUInt32LE(4),
    flags = b.readUInt32LE(8)
  if (!(flags & 1)) return []
  const out: string[] = []
  if (headerSize >= 0x24 && b.length >= 0x24) {
    const base = b.readUInt32LE(28),
      suffix = b.readUInt32LE(32)
    if (base) out.push(cstr16(b, base) + (suffix ? cstr16(b, suffix) : ''))
  }
  const suffix = cstr(b, b.readUInt32LE(24))
  for (const base of decodings(cstr(b, b.readUInt32LE(16))))
    for (const tail of suffix.length ? decodings(suffix) : ['']) out.push(base + tail)
  return out
}

/** %VAR% 换成环境变量（Windows 上不分大小写）；没有的变量原样留着 */
export function expandEnv(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/%([^%]+)%/g, (all, name: string) => {
    const key = Object.keys(env).find(k => k.toUpperCase() === name.toUpperCase())
    return key === undefined ? all : (env[key] ?? all)
  })
}

/**
 * 快捷方式可能指着的目标（按可信程度排，没有去查存不存在）：环境变量形式的目标（展开）→ LinkInfo 的本地路径
 * → ID 列表里的路径 → 相对路径（按快捷方式所在目录算）。格式不对、MSI 播发的返回空；读到一半坏了的返回已经拿到的。
 */
export function shortcutTargets(data: Uint8Array, lnkPath: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (b.length < HEADER_SIZE || b.readUInt32LE(0) !== HEADER_SIZE || b.toString('hex', 4, 20) !== CLSID) return []
  const flags = b.readUInt32LE(0x14)
  if (flags & HAS_DARWIN_ID) return []
  const fromInfo: string[] = [],
    fromEnv: string[] = [],
    fromIdList: string[] = [],
    relative: string[] = []
  try {
    let at = HEADER_SIZE
    if (flags & HAS_ID_LIST) {
      const size = b.readUInt16LE(at)
      const path = idListPath(b.subarray(at + 2, at + 2 + size))
      if (path) fromIdList.push(path)
      at += 2 + size
    }
    if (flags & HAS_LINK_INFO) {
      const size = b.readUInt32LE(at)
      if (!(flags & FORCE_NO_LINK_INFO)) fromInfo.push(...linkInfoPaths(b.subarray(at, at + size)))
      at += size
    }
    const unicode = !!(flags & IS_UNICODE)
    for (const flag of [HAS_NAME, HAS_RELATIVE_PATH, HAS_WORKING_DIR, HAS_ARGUMENTS, HAS_ICON_LOCATION]) {
      if (!(flags & flag)) continue
      const count = b.readUInt16LE(at),
        bytes = unicode ? count * 2 : count
      if (at + 2 + bytes > b.length) throw new RangeError('truncated')
      const text = b.subarray(at + 2, at + 2 + bytes)
      if (flag === HAS_RELATIVE_PATH)
        for (const path of unicode ? [text.toString('utf16le')] : decodings(text))
          relative.push(win32.resolve(win32.dirname(lnkPath), path))
      at += 2 + bytes
    }
    while (at + 8 <= b.length) {
      const size = b.readUInt32LE(at)
      if (size < 8) break
      if (b.readUInt32LE(at + 4) === ENVIRONMENT_BLOCK && size >= 0x314 && flags & HAS_EXP_STRING) {
        const wide = cstr16(b, at + 8 + 260, 520)
        for (const target of wide ? [wide] : decodings(cstr(b, at + 8, 260))) fromEnv.push(expandEnv(target, env))
      }
      at += size
    }
  } catch {
    // 截断或乱数据：前面拿到的照用
  }
  return [...new Set([...fromEnv, ...fromInfo, ...fromIdList, ...relative].filter(Boolean))]
}

export interface ShortcutTarget {
  /** 快捷方式的名字（文件名去掉 .lnk），如「IntelliJ IDEA 2026.2.1」 */
  name: string
  /** 实际存在的目标程序（.exe） */
  target: string
}

const MAX_FILES = 3000
const MAX_SIZE = 64 * 1024

/** 开始菜单（最多 5 层）和桌面（只看第一层）的 .lnk 文件 */
async function shortcutFiles(env: NodeJS.ProcessEnv): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return
      if (e.isDirectory()) {
        if (depth > 1) await walk(join(dir, e.name), depth - 1)
      } else if (e.name.toLowerCase().endsWith('.lnk')) files.push(join(dir, e.name))
    }
  }
  const menu = (root: string | undefined): string | null =>
    root ? join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null
  for (const dir of [menu(env.ProgramData), menu(env.APPDATA)]) if (dir) await walk(dir, 5)
  for (const root of [env.PUBLIC, env.USERPROFILE]) if (root) await walk(join(root, 'Desktop'), 1)
  return files
}

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 本机开始菜单和桌面上指着 .exe 的快捷方式（目标要实际存在）；同一个程序只留一条。只在 Windows 上有 */
export async function findShortcuts(env: NodeJS.ProcessEnv = process.env): Promise<ShortcutTarget[]> {
  if (process.platform !== 'win32') return []
  const files = await shortcutFiles(env)
  const found: ShortcutTarget[] = []
  // 分批读，快捷方式很多时也不会一下打开几千个文件
  for (let i = 0; i < files.length; i += 64) {
    const batch = await Promise.all(
      files.slice(i, i + 64).map(async file => {
        try {
          if ((await stat(file)).size > MAX_SIZE) return null
          const targets = shortcutTargets(await readFile(file), file, env).filter(t => /\.exe$/i.test(t))
          for (const target of targets)
            if (await isFile(target)) return { name: basename(file).replace(/\.lnk$/i, ''), target }
        } catch {
          // 读不了的跳过
        }
        return null
      }),
    )
    for (const s of batch) if (s && !found.some(f => f.target.toLowerCase() === s.target.toLowerCase())) found.push(s)
  }
  return found
}
