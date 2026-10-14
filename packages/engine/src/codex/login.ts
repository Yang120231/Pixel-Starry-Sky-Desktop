// Codex 授权登录（codex login / codex login --device-auth）的输出识别（docs/ui/model-channels.md §3）

import { plainLine } from '../exec'

/**
 * 一行输出里的授权信息。浏览器登录把网址单独印在一行（https://auth.openai.com/oauth/authorize?...），
 * 本地回调的 http://localhost:1455 不算；设备码登录印 https://auth.openai.com/codex/device 和 WHYJ-RGMV5 这样的一次性码
 */
export function parseCodexLogin(raw: string): { url?: string; userCode?: string } {
  const line = plainLine(raw)
  const out: { url?: string; userCode?: string } = {}
  const url = /https:\/\/auth\.openai\.com\/\S*/.exec(line)?.[0]
  if (url) out.url = url
  const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/.exec(line)?.[0]
  if (code) out.userCode = code
  return out
}
