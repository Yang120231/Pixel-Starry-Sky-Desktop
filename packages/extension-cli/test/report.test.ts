import { describe, expect, it } from 'vitest'
import { checkVerdict, grammarIssue } from '@pixelsky/protocol/extpacks'
import type { ExtPackIssue } from '@pixelsky/protocol/extpacks'
import type { CheckReport } from '../src/lib/check'
import { renderText } from '../src/cli/report/text'

function report(issues: ExtPackIssue[], over: Partial<CheckReport> = {}): CheckReport {
  return {
    input: { kind: 'folder', path: '/x', bytes: null },
    level: 'upload',
    grammarMode: 'full',
    appVersion: null,
    strict: false,
    files: { entries: [], read: () => null } as unknown as CheckReport['files'],
    skipped: [],
    check: { id: null, manifest: null, files: new Map(), issues, status: 'error', inactive: {}, skills: [] },
    grammar: null,
    grammarSkipped: null,
    verdict: checkVerdict(issues, { level: 'upload', strict: false }),
    ...over,
  } as CheckReport
}

const render = (r: CheckReport, lang: 'zh' | 'en' = 'zh'): string =>
  renderText(r, { lang, color: false, command: 'validate' })

describe('renderText', () => {
  it('文案末尾已经带着路径时不重复写位置', () => {
    const issue: ExtPackIssue = {
      severity: 'error',
      scope: 'file',
      code: 'svg.unsafe',
      message: { zh: 'SVG 含有脚本：icons/bad.svg', en: 'SVG has scripts: icons/bad.svg' },
      path: 'icons/bad.svg',
      upload: 'reject',
    }
    const zh = render(report([issue]))
    expect(zh.split('icons/bad.svg')).toHaveLength(2)
    expect(zh).toContain('SVG 含有脚本')
    const en = render(report([issue]), 'en')
    expect(en.split('icons/bad.svg')).toHaveLength(2)
    // 共享的文案本身没被改
    expect(issue.message.zh).toBe('SVG 含有脚本：icons/bad.svg')
  })

  it('文案不带路径时照常写位置', () => {
    const issue: ExtPackIssue = {
      severity: 'warning',
      scope: 'file',
      code: 'files.unused',
      message: { zh: '清单没有引用这个文件', en: 'x' },
      path: 'notes/todo.md',
      upload: 'hint',
    }
    expect(render(report([issue]))).toMatch(/ {2}· notes\/todo\.md {2}清单没有引用这个文件/)
  })

  it('regexes 为 null 显示「没有检查（编译超时或失败）」', () => {
    const r = report([], { grammar: [{ index: 0, scopeName: 'source.x', regexes: null, samples: [] }] })
    expect(render(r)).toContain('语法  source.x  没有检查（编译超时或失败）')
    expect(render(r, 'en')).toContain('grammar  source.x  not checked (compile hung or failed)')
  })

  it('编译就卡死：「没有检查」加上语法文件的卡死文案', () => {
    const issue = grammarIssue('grammar.hang', {
      index: 0,
      path: 'syntaxes/x.tmLanguage.json',
      limitMs: 10_000,
      detail: 'compile',
    })
    const r = report([issue], { grammar: [{ index: 0, scopeName: 'source.x', regexes: null, samples: [] }] })
    const zh = render(r)
    expect(zh).toContain('没有检查（编译超时或失败）')
    expect(zh).toContain('分词超过 10 秒还没完成，可能有回溯爆炸的正则（语法文件 syntaxes/x.tmLanguage.json）')
    expect(render(r, 'en')).toContain(
      'Tokenizing did not finish within 10 s; a regex may backtrack catastrophically (grammar file syntaxes/x.tmLanguage.json)',
    )
  })
})
