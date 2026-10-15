import { describe, expect, it } from 'vitest'
import type { ExtPackIssue } from './types'
import { checkVerdict, issueOutcome } from './verdict'

const issue = (over: Partial<ExtPackIssue>): ExtPackIssue => ({
  severity: 'warning',
  scope: 'file',
  code: 'files.type',
  message: { zh: 'x', en: 'x' },
  ...over,
})

describe('issueOutcome', () => {
  it('upload 字段优先', () => {
    expect(issueOutcome(issue({ upload: 'reject' }))).toBe('reject')
    expect(issueOutcome(issue({ upload: 'hint', severity: 'error' }))).toBe('hint')
  })
  it('没写 upload：error 拒绝，warning 只在本地', () => {
    expect(issueOutcome(issue({ severity: 'error' }))).toBe('reject')
    expect(issueOutcome(issue({}))).toBe('note')
  })
  it('内部出错的两个代码拒绝', () => {
    expect(issueOutcome(issue({ code: 'validate.internal' }))).toBe('reject')
    expect(issueOutcome(issue({ code: 'pack.validate' }))).toBe('reject')
  })
})

describe('checkVerdict', () => {
  const issues = [
    issue({ upload: 'reject' }), // warning / reject
    issue({ severity: 'error', upload: 'reject' }), // error / reject
    issue({ upload: 'hint' }), // warning / hint
    issue({}), // warning / note
  ]
  it('upload：拒绝的算数；strict 时提示也算', () => {
    const v = checkVerdict(issues, { level: 'upload' })
    expect(v).toEqual({ pass: false, blocking: 2, counts: { error: 1, warning: 3, reject: 2, hint: 1, note: 1 } })
    expect(checkVerdict(issues, { level: 'upload', strict: true }).blocking).toBe(3)
  })
  it('upload：只有提示和仅本地的，通过；strict 就不通过', () => {
    const rest = issues.slice(2)
    expect(checkVerdict(rest, { level: 'upload' }).pass).toBe(true)
    expect(checkVerdict(rest, { level: 'upload', strict: true })).toMatchObject({ pass: false, blocking: 1 })
  })
  it('dev：error 算数；strict 时 warning 也算', () => {
    expect(checkVerdict(issues, { level: 'dev' })).toMatchObject({ pass: false, blocking: 1 })
    expect(checkVerdict(issues, { level: 'dev', strict: true }).blocking).toBe(4)
    expect(
      checkVerdict(
        issues.filter(i => i.severity === 'warning'),
        { level: 'dev' },
      ).pass,
    ).toBe(true)
  })
  it('没有问题：通过', () => {
    expect(checkVerdict([], { level: 'upload', strict: true })).toEqual({
      pass: true,
      blocking: 0,
      counts: { error: 0, warning: 0, reject: 0, hint: 0, note: 0 },
    })
  })
})
