import { deflateRawSync } from 'node:zlib'
import { crc32 } from '../../src/lib/crc32'

/** 手写 zip 的一个条目；每个字段都能覆盖，用来造各种畸形包 */
export interface RawEntry {
  /** 字符串按 UTF-8 编码；要造非 UTF-8 名字就直接给字节 */
  name: string | Uint8Array
  data?: Uint8Array | string
  /** 压缩方式，默认 8（deflate）；0 = 存储 */
  method?: number
  flags?: number
  madeBy?: number
  extAttr?: number
  /** 覆盖中央目录里的字段（不改实际数据） */
  crc?: number
  usize?: number
  csize?: number
  /** 直接指定压缩后的字节，不经过 deflate */
  rawData?: Uint8Array
}

export interface RawZipOptions {
  /** 覆盖 EOCD 字段 */
  eocd?: { disk?: number; cdDisk?: number; countHere?: number; count?: number; cdSize?: number; cdOffset?: number }
  comment?: string
  /** 在 EOCD 前插入垃圾字节 */
  noEocd?: boolean
}

const enc = new TextEncoder()
const bytes = (v: Uint8Array | string): Uint8Array => (typeof v === 'string' ? enc.encode(v) : v)

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff]
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}

export function buildRawZip(entries: RawEntry[], opts: RawZipOptions = {}): Uint8Array {
  const parts: number[] = []
  const central: number[] = []
  for (const e of entries) {
    const name = bytes(e.name)
    const data = bytes(e.data ?? '')
    const method = e.method ?? 8
    const comp = e.rawData ?? (method === 8 ? new Uint8Array(deflateRawSync(data)) : data)
    const crc = e.crc ?? crc32(data)
    const csize = e.csize ?? comp.length
    const usize = e.usize ?? data.length
    const flags = e.flags ?? (typeof e.name === 'string' && /[\u0080-￿]/.test(e.name) ? 0x800 : 0)
    const offset = parts.length
    parts.push(...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21))
    parts.push(...u32(crc), ...u32(csize), ...u32(usize), ...u16(name.length), ...u16(0), ...name, ...comp)
    central.push(...u32(0x02014b50), ...u16(e.madeBy ?? 20), ...u16(20), ...u16(flags), ...u16(method))
    central.push(...u16(0), ...u16(0x21), ...u32(crc), ...u32(csize), ...u32(usize))
    central.push(...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(e.extAttr ?? 0))
    central.push(...u32(offset), ...name)
  }
  const cdOffset = parts.length
  const all = [...parts, ...central]
  if (!opts.noEocd) {
    const o = opts.eocd ?? {}
    const comment = enc.encode(opts.comment ?? '')
    all.push(...u32(0x06054b50), ...u16(o.disk ?? 0), ...u16(o.cdDisk ?? 0))
    all.push(...u16(o.countHere ?? entries.length), ...u16(o.count ?? entries.length))
    all.push(...u32(o.cdSize ?? central.length), ...u32(o.cdOffset ?? cdOffset), ...u16(comment.length), ...comment)
  }
  return Uint8Array.from(all)
}

/** 最小的合法清单 */
export const MINIMAL_MANIFEST = JSON.stringify({ id: 'a.b', name: 'A', version: '1.0.0' })
