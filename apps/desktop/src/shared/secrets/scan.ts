// 疑似密钥扫描（docs/ui/conversation-export.md §3）：规则固定，不接用户自定义；按正则匹配，可能有误报。
// 放在 shared：导出对话现在用，以后发送前提醒、频道分享也用同一份。

export type SecretKind = 'sk' | 'github' | 'aws' | 'private-key' | 'assignment'

export interface SecretHit {
  kind: SecretKind
  /** 整个匹配的范围 [start, end) */
  start: number
  end: number
  /** 打码的范围 [maskFrom, end)：前缀（sk-、ghp_、KEY= 等）留着，让人认得出是哪一类 */
  maskFrom: number
}

/** 导出时命中的部分换成它（长度固定，不泄露原长度） */
export const MASK = '••••'

// 赋值里这些值不算密钥：代码里的变量引用、占位符、已经打过码的
const PLACEHOLDER =
  /^(?:\$|<|\{|%|your[_-]|xxx|changeme|process\.env|os\.environ|env\.|getenv|null$|undefined$|true$|false$)/i

type Rule = {
  kind: SecretKind
  pattern: RegExp
  maskFrom(m: RegExpExecArray): number
  skip?(m: RegExpExecArray): boolean
}

const RULES: Rule[] = [
  // sk-...、sk-proj-...、sk-ant-api03-...
  { kind: 'sk', pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, maskFrom: m => m.index + 3 },
  // ghp_ / gho_ / github_pat_
  { kind: 'github', pattern: /\b(?:ghp_|gho_)[A-Za-z0-9]{20,}/g, maskFrom: m => m.index + 4 },
  { kind: 'github', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g, maskFrom: m => m.index + 11 },
  { kind: 'aws', pattern: /\bAKIA[0-9A-Z]{16}\b/g, maskFrom: m => m.index + 4 },
  // 私钥块；没有结尾行（被截断了）就算到文本末尾，结尾行留着
  {
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?=-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    maskFrom: m => m.index + m[0].indexOf('-----', 5) + 5,
  },
  // KEY=... / TOKEN=... / SECRET=... / PASSWORD=...（名字以这几个词结尾；等号，或冒号加引号的 JSON 写法）
  {
    kind: 'assignment',
    pattern:
      /[A-Za-z0-9_.-]{0,40}?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)["']?\s*(?:=(?!=)\s*|:\s*(?=["']))["']?([^\s"'`,;]{8,})/gi,
    maskFrom: m => m.index + m[0].length - m[1].length,
    skip: m => PLACEHOLDER.test(m[1]) || /[()]/.test(m[1]) || /^\d+$/.test(m[1]),
  },
]

/** 找出文本里的疑似密钥，按位置排序；重叠的算一处：留先出现的（`OPENAI_KEY=sk-…`），后面的盖得更远则留后面的（`KEY="-----BEGIN…私钥块`） */
export function scanSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = []
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    for (let m = rule.pattern.exec(text); m; m = rule.pattern.exec(text)) {
      if (m[0].length === 0) rule.pattern.lastIndex++
      else if (!rule.skip?.(m))
        hits.push({ kind: rule.kind, start: m.index, end: m.index + m[0].length, maskFrom: rule.maskFrom(m) })
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: SecretHit[] = []
  for (const hit of hits) {
    const last = out.at(-1)
    if (!last || hit.start >= last.end) out.push(hit)
    else if (hit.end > last.end) out[out.length - 1] = hit // 后面的盖住更多（赋值里带私钥块）就换成它
  }
  return out
}

/** 命中的部分换成 MASK；没有命中原样返回 */
export function redactSecrets(text: string, hits: SecretHit[] = scanSecrets(text)): string {
  let out = ''
  let at = 0
  for (const hit of hits) {
    out += text.slice(at, hit.maskFrom) + MASK
    at = hit.end
  }
  return out + text.slice(at)
}

/** 给界面列出的片段：前缀 + •••• + 末 4 位（被打码的部分够长时才露末 4 位），不含完整明文 */
export function hitSnippet(text: string, hit: SecretHit): string {
  const secret = text.slice(hit.maskFrom, hit.end)
  const tail = secret.length >= 16 && hit.kind !== 'private-key' ? secret.slice(-4) : ''
  return text.slice(hit.start, hit.maskFrom).replace(/\s+/g, ' ') + MASK + tail
}
