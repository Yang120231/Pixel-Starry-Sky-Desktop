// 字节工具：各平台通用，不用 Buffer
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export const utf8 = (text: string): Uint8Array => encoder.encode(text)
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes)

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url，不带填充（放进二维码和 JSON） */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64[n & 63]
  }
  return out
}

export function fromBase64Url(text: string): Uint8Array {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1)
    throw new Error('LINK_BAD_ENCODING')
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let bits = 0,
    value = 0,
    o = 0
  for (const ch of text) {
    value = (value << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (value >> bits) & 255
    }
  }
  return out
}

/** 等长比较，耗时不随第一个不同字节的位置变化 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
