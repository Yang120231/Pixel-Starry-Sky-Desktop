// 检查结论：把一条问题归到「会被拒绝 / 提示 / 仅本地」，再按级别算是否通过。
import type { ExtCheckLevel, ExtIssueOutcome, ExtPackIssue } from './types'

/** 上传时这条问题的归宿。upload 字段没写的：error 当作拒绝（软件本来就不加载 / 停用），其余只在本地提示 */
export function issueOutcome(i: ExtPackIssue): ExtIssueOutcome {
  if (i.upload === 'reject') return 'reject'
  if (i.upload === 'hint') return 'hint'
  if (i.severity === 'error' || i.code === 'validate.internal' || i.code === 'pack.validate') return 'reject'
  return 'note'
}

export interface ExtCheckVerdict {
  pass: boolean
  /** 让检查不通过的条数 */
  blocking: number
  counts: { error: number; warning: number; reject: number; hint: number; note: number }
}

/** upload：拒绝的算数（strict 时提示也算）；dev：error 算数（strict 时 warning 也算） */
export function checkVerdict(
  issues: ExtPackIssue[],
  opts: { level: ExtCheckLevel; strict?: boolean },
): ExtCheckVerdict {
  const counts = { error: 0, warning: 0, reject: 0, hint: 0, note: 0 }
  let blocking = 0
  for (const i of issues) {
    counts[i.severity]++
    const outcome = issueOutcome(i)
    counts[outcome]++
    const blocks =
      opts.level === 'upload'
        ? outcome === 'reject' || (opts.strict === true && outcome === 'hint')
        : i.severity === 'error' || (opts.strict === true && i.severity === 'warning')
    if (blocks) blocking++
  }
  return { pass: blocking === 0, blocking, counts }
}
