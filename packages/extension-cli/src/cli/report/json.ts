import { issueOutcome, EXT_RULES_VERSION } from '@pixelsky/protocol/extpacks'
import type { CheckReport } from '../../lib/check'
import { APP_VERSION, TOOL_VERSION } from '../version'
import type { PackOutput } from './text'

const round1 = (n: number): number => Math.round(n * 10) / 10

/** 结构见 docs/extensions/cli.md §6.2 */
export function toJson(r: CheckReport, o: { command: 'validate' | 'pack'; output?: PackOutput | null }): object {
  const m = r.check.manifest
  let total = 0
  for (const n of r.check.files.values()) total += n
  const upload = r.level === 'upload'
  return {
    schema: 1,
    tool: { name: 'pixelsky-ext', version: TOOL_VERSION, rulesVersion: EXT_RULES_VERSION, appVersion: APP_VERSION },
    command: o.command,
    input: r.input,
    options: { level: r.level, grammar: r.grammarMode, appVersion: r.appVersion, strict: r.strict },
    pack: m ? { id: m.id, version: m.version, files: r.check.files.size, bytes: total } : null,
    status: r.check.status,
    inactive: r.check.inactive,
    verdict: { pass: r.verdict.pass, blocking: r.verdict.blocking },
    counts: r.verdict.counts,
    // 上传档每条多一个 outcome；dev 档不加，靠 verdict / counts
    issues: r.check.issues.map(i => (upload ? { ...i, outcome: issueOutcome(i) } : { ...i })),
    grammar: {
      mode: r.grammarMode,
      skipped: r.grammarSkipped,
      grammars: (r.grammar ?? []).map(g => ({
        index: g.index,
        scopeName: g.scopeName,
        regexes: g.regexes,
        samples: g.samples.map(s => ({
          path: s.path,
          sourceLines: s.sourceLines,
          lines: s.lines,
          totalMs: round1(s.totalMs),
          budgetMs: round1(s.budgetMs),
          slowestMs: round1(s.slowestMs),
          slowestLine: s.slowestLine,
        })),
      })),
    },
    skipped: r.skipped,
    notChecked: upload ? ['publisher', 'versionIncrement', 'listedConflicts'] : [],
    output: o.output ?? null,
  }
}
