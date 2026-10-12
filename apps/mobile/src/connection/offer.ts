// 配对文字（二维码内容 / 配对链接）的解析。不碰存储和网络，单独放在这里方便测试。
import { decodeOffer, fingerprint, fromBase64Url, type PairingOffer } from '@pixelsky/link'

/** 二维码里的电脑信息（给配对页显示） */
export interface Offer {
  raw: PairingOffer
  desktopName: string
  fingerprint: string
  expired: boolean
}

/** 读网页地址里的 #pair=…；不是配对链接返回 null，格式不对抛错 */
export function readOffer(href: string): Offer | null {
  return /#pair=/.test(href) ? parseOffer(href) : null
}

/** 扫到的二维码文字（网页链接或 pixelsky://pair?d=…）；格式不对抛错 */
export function parseOffer(text: string): Offer {
  const raw = decodeOffer(text)
  return {
    raw,
    desktopName: raw.name,
    fingerprint: fingerprint(fromBase64Url(raw.key)),
    expired: Date.now() > raw.expires,
  }
}

// 配对链接的两种写法；数据部分是 base64url（字母数字 - _）
const LINKS = /pixelsky:\/\/pair\?d=[A-Za-z0-9_-]+|https?:\/\/[^\s#<>"'“”‘’，。]*#pair=[A-Za-z0-9_-]+/gi

/** 把可能被百分号编码的文字还原（解不开就原样用） */
function unescapeText(text: string): string {
  if (!/%[0-9a-f]{2}/i.test(text)) return text
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * 从粘贴的任意文字里找出配对链接并解析：前后可以有别的字、空白、换行，链接里不能有空白（聊天软件折行时会补回去）。
 * 找不到、链接坏了、已过期都抛带中文说明的错。
 */
export function findOffer(pasted: string): Offer {
  const text = unescapeText(pasted)
  // 先按原文找；解不开再试「去掉链接数据里夹的空白」（聊天软件折行）
  const unwrapped = text.replace(
    /((?:#pair=|\?d=)[A-Za-z0-9_-]*)((?:[ \t]*\r?\n[ \t]*[A-Za-z0-9_-]+)+)/gi,
    (_, a: string, b: string) => a + b.replace(/\s+/g, ''),
  )
  const tokens: string[] = []
  for (const t of [text, unwrapped]) {
    for (const m of t.matchAll(LINKS)) if (!tokens.includes(m[0])) tokens.push(m[0])
  }
  if (!tokens.length)
    throw new Error(
      /pair|pixelsky/i.test(text)
        ? '这个链接不完整或被改动过，请回到电脑上重新复制配对链接。'
        : '没有找到配对链接。请在电脑的 设置 › 手机 › 添加手机 里点「复制配对链接」，再粘贴到这里。',
    )
  // 多个链接时取第一个能解开且没过期的；只有全都过期才报过期
  const offers: Offer[] = []
  for (const token of tokens) {
    try {
      offers.push(parseOffer(token))
    } catch {
      // 换下一个候选
    }
  }
  if (!offers.length) throw new Error('这个配对链接不对（可能复制得不完整），请在电脑上重新复制。')
  const fresh = offers.find(o => !o.expired)
  if (!fresh) throw new Error('这个配对链接已经过期（5 分钟有效），请在电脑上重新生成。')
  return fresh
}
