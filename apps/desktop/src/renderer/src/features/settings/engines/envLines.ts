// 环境变量文本框 ↔ 对象（设置 › 本机引擎）
/** 「KEY=VALUE」每行一条 ↔ 对象；空行和 # 开头的行忽略 */
export function parseEnvLines(text: string): { env: Record<string, string>; bad: string | null } {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    const key = i > 0 ? line.slice(0, i).trim() : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { env, bad: line }
    env[key] = line.slice(i + 1)
  }
  return { env, bad: null }
}

export function envLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}
