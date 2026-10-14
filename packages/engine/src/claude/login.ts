// Claude Code 授权登录（claude auth login）的输出识别（docs/ui/model-channels.md §3）

import { plainLine } from '../exec'

/**
 * 一行输出里的授权信息：
 *   If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...
 *   Paste code here if prompted >      （没有换行，命令在等用户粘贴授权码）
 */
export function parseClaudeLogin(raw: string): { url?: string; awaitingCode?: boolean } {
  const line = plainLine(raw)
  const out: { url?: string; awaitingCode?: boolean } = {}
  const url = /https:\/\/\S+/.exec(line)?.[0]
  if (url) out.url = url
  if (/paste code/i.test(line)) out.awaitingCode = true
  return out
}
