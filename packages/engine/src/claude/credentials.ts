// Claude Code 登录凭据的时间（docs/ui/claude-login-recovery.md §1）：只读 .credentials.json 里访问凭据、刷新凭据的到期时间，
// 判断要不要先刷新登录、写进日志。凭据本身（accessToken / refreshToken）不取出、不记录。
// macOS 上凭据在钥匙串里（条目名带目录哈希），读不到返回 null
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ClaudeLoginTimes {
  /** 有订阅登录（claudeAiOauth 里有刷新凭据）；API Key 登录、没登录、凭据被 Claude Code 清空了都为假 */
  signedIn: boolean
  /** 访问凭据的到期时间（毫秒）；没有为 null */
  expiresAt: number | null
  /** 刷新凭据的到期时间（毫秒）；旧版 Claude Code 不写，为 null */
  refreshExpiresAt: number | null
}

const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** 从文件内容里取（测试用） */
export function parseLoginTimes(text: string): ClaudeLoginTimes {
  let o: unknown
  try {
    o = (JSON.parse(text) as { claudeAiOauth?: unknown })?.claudeAiOauth
  } catch {
    o = null
  }
  if (!o || typeof o !== 'object') return { signedIn: false, expiresAt: null, refreshExpiresAt: null }
  const oauth = o as Record<string, unknown>
  return {
    signedIn: typeof oauth.refreshToken === 'string' && oauth.refreshToken.length > 0,
    expiresAt: time(oauth.expiresAt),
    refreshExpiresAt: time(oauth.refreshTokenExpiresAt),
  }
}

/** 这个配置目录的登录时间；macOS（钥匙串）为 null，其他系统没有文件时当没登录 */
export function claudeLoginTimes(
  configDir: string,
  platform: NodeJS.Platform = process.platform,
): ClaudeLoginTimes | null {
  if (platform === 'darwin') return null
  let text: string
  try {
    text = readFileSync(join(configDir, '.credentials.json'), 'utf8')
  } catch {
    return { signedIn: false, expiresAt: null, refreshExpiresAt: null }
  }
  return parseLoginTimes(text)
}

/** 写日志用：到期时间换成 ISO 时间和距现在的分钟数（负数是已经过期），不带凭据 */
export function describeLoginTimes(t: ClaudeLoginTimes | null, now = Date.now()): Record<string, unknown> {
  if (!t) return { credentials: 'keychain' }
  const at = (v: number | null) =>
    v === null ? null : { at: new Date(v).toISOString(), inMin: Math.round((v - now) / 60_000) }
  return { signedIn: t.signedIn, access: at(t.expiresAt), refresh: at(t.refreshExpiresAt) }
}
