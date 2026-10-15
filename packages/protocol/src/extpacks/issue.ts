// 构造一条问题（校验器内部用，不对外导出）。code 只能是 codes.ts 里登记过的。
import type { ExtIssueCode } from './codes'
import type { ExtPackIssue } from './types'

export function mk(
  severity: ExtPackIssue['severity'],
  scope: ExtPackIssue['scope'],
  code: ExtIssueCode,
  zh: string,
  en: string,
  extra?: { path?: string; upload?: ExtPackIssue['upload']; contribution?: ExtPackIssue['contribution'] },
): ExtPackIssue {
  const issue: ExtPackIssue = { severity, scope, code, message: { zh, en } }
  if (extra?.path !== undefined) issue.path = extra.path
  if (extra?.contribution) issue.contribution = extra.contribution
  if (extra?.upload) issue.upload = extra.upload
  return issue
}

/** 清单带注释 / 结尾逗号但 JSONC 能读：checkPack 和 validateManifest（传原文时）都用这一条，措辞统一 */
export function manifestJsoncIssue(path: string): ExtPackIssue {
  return mk(
    'warning',
    'file',
    'manifest.jsonc',
    '清单里有注释或结尾逗号，上架前要改成标准 JSON',
    'The manifest has comments or trailing commas; use plain JSON before publishing',
    { path, upload: 'reject' },
  )
}
