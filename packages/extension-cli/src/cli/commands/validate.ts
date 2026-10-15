import { resolve } from 'node:path'
import { checkInput } from '../../lib/check'
import type { ParsedCli } from '../args'
import type { CliHooks, CliIo } from '../io'
import { toJson } from '../report/json'
import { renderText } from '../report/text'

export async function runValidate(p: ParsedCli, io: CliIo, hooks: CliHooks = {}): Promise<number> {
  const run = hooks.checkInput ?? checkInput
  const report = await run(resolve(io.cwd, p.path), {
    level: p.level,
    grammar: p.grammar,
    appVersion: p.appVersion ?? undefined,
    strict: p.strict,
    runner: hooks.runner,
  })
  if (p.json) io.out(JSON.stringify(toJson(report, { command: 'validate' }), null, 2) + '\n')
  else io.out(renderText(report, { lang: p.lang, color: p.color, command: 'validate' }))
  return report.verdict.pass ? 0 : 1
}
