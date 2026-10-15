// 共享用例专用的手写 zip 写入器：每个字段都能覆盖，用来造畸形包（只给测试用，不进发布的 bundle）
import { deflateRawSync } from 'node:zlib'
import { crc32 } from '../lib/crc32'

/** 用例 JSON 里的一个 zip 条目 */
export interface RawZipEntry {
  /** 条目名（UTF-8）；和 nameBase64 二选一 */
  name?: string
  /** 条目名的原始字节（用来造 GBK 之类的非 UTF-8 名字） */
  nameBase64?: string
  text?: string
  base64?: string
  /** 重复 repeat 直到 bytes 字节 */
  repeat?: string
  bytes?: number
  /** 符号链接：内容是链接目标 */
  symlink?: string
  /** 目录条目（名字自动补 /） */
  dir?: boolean
  /** 加密标志（flag bit 0） */
  encrypted?: boolean
  /** 压缩方式，默认 8；设 0 = 存储；其他值造「不支持的压缩」 */
  method?: number
  /** 中央目录里写错的 CRC */
  badCrc?: boolean
  /** 中央目录里写错的未压缩大小 */
  badSize?: boolean
  /** 名字有非 ASCII 字节时也不置 UTF-8 标志 */
  noUtf8Flag?: boolean
}

export interface RawZipOptions {
  /** 覆盖 EOCD 字段（造分卷 / zip64 标记） */
  eocd?: { disk?: number; cdDisk?: number; countHere?: number; count?: number; cdSize?: number; cdOffset?: number }
  /** 不写 EOCD */
  noEocd?: boolean
}

/** 已经解析好字节的条目（writer 的输入） */
export interface RawZipBuilt {
  name: Uint8Array
  data: Uint8Array
  method: number
  flags: number
  madeBy: number
  extAttr: number
  badCrc: boolean
  badSize: boolean
}

const enc = new TextEncoder()
const u16 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff]
const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]

function b64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'))
}

/** 把用例条目变成字节；符号链接走 Unix 属性 */
export function buildEntry(e: RawZipEntry): RawZipBuilt {
  let name = e.nameBase64 !== undefined ? b64(e.nameBase64) : enc.encode(e.name ?? '')
  if (e.dir && name.length > 0 && name[name.length - 1] !== 0x2f) name = Uint8Array.from([...name, 0x2f])
  let data: Uint8Array
  if (e.symlink !== undefined) data = enc.encode(e.symlink)
  else if (e.base64 !== undefined) data = b64(e.base64)
  else if (e.repeat !== undefined && e.bytes !== undefined) {
    data = new Uint8Array(e.bytes)
    const unit = enc.encode(e.repeat)
    for (let i = 0; i < e.bytes; i++) data[i] = unit[i % unit.length]
  } else data = enc.encode(e.text ?? '')
  const nonAscii = name.some(b => b >= 0x80)
  let flags = nonAscii && !e.noUtf8Flag ? 0x800 : 0
  if (e.encrypted) flags |= 0x1
  return {
    name,
    data,
    method: e.method ?? 8,
    flags,
    madeBy: e.symlink !== undefined ? (3 << 8) | 20 : 20,
    extAttr: e.symlink !== undefined ? (0o120777 << 16) >>> 0 : 0,
    badCrc: e.badCrc === true,
    badSize: e.badSize === true,
  }
}

export function writeRawZip(entries: RawZipBuilt[], opts: RawZipOptions = {}): Uint8Array {
  // 用块列表拼接：大条目（10 MB）不能用展开运算符
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let partsLen = 0
  const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n)
  const pushParts = (...chunks: Uint8Array[]): void => {
    for (const c of chunks) {
      parts.push(c)
      partsLen += c.length
    }
  }
  for (const e of entries) {
    const comp = e.method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data
    const crc = e.badCrc ? (crc32(e.data) ^ 0xdeadbeef) >>> 0 : crc32(e.data)
    const usize = e.badSize ? e.data.length + 7 : e.data.length
    const offset = partsLen
    pushParts(
      bytes(...u32(0x04034b50), ...u16(20), ...u16(e.flags), ...u16(e.method), ...u16(0), ...u16(0x21)),
      bytes(...u32(crc), ...u32(comp.length), ...u32(usize), ...u16(e.name.length), ...u16(0)),
      e.name,
      comp,
    )
    central.push(
      bytes(
        ...u32(0x02014b50),
        ...u16(e.madeBy),
        ...u16(20),
        ...u16(e.flags),
        ...u16(e.method),
        ...u16(0),
        ...u16(0x21),
        ...u32(crc),
        ...u32(comp.length),
        ...u32(usize),
        ...u16(e.name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(e.extAttr),
        ...u32(offset),
      ),
      e.name,
    )
  }
  const cdLen = central.reduce((n, c) => n + c.length, 0)
  const chunks = [...parts, ...central]
  if (!opts.noEocd) {
    const o = opts.eocd ?? {}
    chunks.push(
      bytes(
        ...u32(0x06054b50),
        ...u16(o.disk ?? 0),
        ...u16(o.cdDisk ?? 0),
        ...u16(o.countHere ?? entries.length),
        ...u16(o.count ?? entries.length),
        ...u32(o.cdSize ?? cdLen),
        ...u32(o.cdOffset ?? partsLen),
        ...u16(0),
      ),
    )
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
