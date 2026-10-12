// exe 自带的版本信息（ProductVersion，和文件属性里「产品版本」、PowerShell 的 VersionInfo 一样）：
// 按 PE 格式找到资源里的版本块，只读那几小段，不开进程（docs/ui/open-with.md）
import { open, type FileHandle } from 'node:fs/promises'

const RT_VERSION = 16
const MAX_BLOCK = 64 * 1024
const KEY = Buffer.from('ProductVersion\0', 'utf16le')
const FIXED_SIGNATURE = 0xfeef04bd

async function read(file: FileHandle, at: number, length: number): Promise<Buffer> {
  const b = Buffer.alloc(length)
  const { bytesRead } = await file.read(b, 0, length, at)
  return b.subarray(0, bytesRead)
}

/** 版本块里的 ProductVersion：先找字符串的，没有再用固定格式的（主.次.修订.构建） */
export function productVersion(block: Buffer): string | undefined {
  let at = block.indexOf(KEY)
  while (at >= 6) {
    // String 结构：wLength、wValueLength（字数）、wType，然后是键名，补齐到 4 字节后是值
    const words = block.readUInt16LE(at - 4)
    const value = (at + KEY.length + 3) & ~3
    if (words > 0 && value < block.length) {
      const end = Math.min(block.length, value + words * 2)
      const text = block.toString('utf16le', value, end).replace(/\0.*$/s, '').trim()
      if (text) return text
    }
    at = block.indexOf(KEY, at + KEY.length)
  }
  for (let i = 0; i + 24 <= block.length; i += 4)
    if (block.readUInt32LE(i) === FIXED_SIGNATURE) {
      const ms = block.readUInt32LE(i + 16),
        ls = block.readUInt32LE(i + 20)
      return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.')
    }
  return undefined
}

/** exe / dll 的产品版本；不是 PE 文件、没有版本信息、读不了时返回 undefined */
export async function exeVersion(path: string): Promise<string | undefined> {
  let file: FileHandle | undefined
  try {
    file = await open(path, 'r')
    const dos = await read(file, 0, 64)
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) return undefined
    const pe = dos.readUInt32LE(0x3c)
    const coff = await read(file, pe, 24)
    if (coff.length < 24 || coff.readUInt32LE(0) !== 0x4550) return undefined
    const sections = coff.readUInt16LE(6),
      optionalSize = coff.readUInt16LE(20)
    const optional = await read(file, pe + 24, optionalSize)
    const magic = optional.length >= 2 ? optional.readUInt16LE(0) : 0
    // 数据目录：PE32 从 96 开始，PE32+ 从 112 开始；第 3 项是资源
    const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1
    if (directories < 0 || optional.length < directories + 24) return undefined
    const resourceRva = optional.readUInt32LE(directories + 16)
    if (!resourceRva) return undefined
    const table = await read(file, pe + 24 + optionalSize, sections * 40)
    const offsetOf = (rva: number): number => {
      for (let i = 0; i + 40 <= table.length; i += 40) {
        const va = table.readUInt32LE(i + 12),
          size = Math.max(table.readUInt32LE(i + 8), table.readUInt32LE(i + 16)),
          raw = table.readUInt32LE(i + 20)
        if (rva >= va && rva < va + size) return raw + rva - va
      }
      return -1
    }
    const base = offsetOf(resourceRva)
    if (base < 0) return undefined
    // 资源目录三层：类型 → 名字 → 语言；版本信息只取第一个
    const entries = async (at: number): Promise<{ id: number; offset: number; dir: boolean }[]> => {
      const head = await read(file!, base + at, 16)
      if (head.length < 16) return []
      const count = Math.min(head.readUInt16LE(12) + head.readUInt16LE(14), 4096)
      const list = await read(file!, base + at + 16, count * 8)
      const out = []
      for (let i = 0; i + 8 <= list.length; i += 8) {
        const target = list.readUInt32LE(i + 4)
        out.push({ id: list.readUInt32LE(i), offset: target & 0x7fffffff, dir: (target & 0x80000000) !== 0 })
      }
      return out
    }
    const type = (await entries(0)).find(e => e.id === RT_VERSION && e.dir)
    const name = type && (await entries(type.offset)).find(e => e.dir)
    const language = name && (await entries(name.offset))[0]
    if (!language || language.dir) return undefined
    const data = await read(file, base + language.offset, 8)
    if (data.length < 8) return undefined
    const at = offsetOf(data.readUInt32LE(0))
    if (at < 0) return undefined
    return productVersion(await read(file, at, Math.min(data.readUInt32LE(4), MAX_BLOCK)))
  } catch {
    return undefined
  } finally {
    await file?.close().catch(() => {})
  }
}
