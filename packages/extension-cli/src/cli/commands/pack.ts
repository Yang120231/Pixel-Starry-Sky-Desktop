import { createHash } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { checkPack, checkVerdict, EXT_ENGINE_CODES, EXT_LIMITS, zipIssue } from '@pixelsky/protocol/extpacks'
import type { ExtPackCheck, ExtPackIssue } from '@pixelsky/protocol/extpacks'
import { checkInput, ToolError, UsageError } from '../../lib/check'
import type { CheckReport } from '../../lib/check'
import { readPackZip } from '../../lib/zip-read'
import { writePackZip } from '../../lib/zip-write'
import type { ParsedCli } from '../args'
import { t } from '../i18n'
import type { CliHooks, CliIo } from '../io'
import { toJson } from '../report/json'
import { renderText } from '../report/text'
import type { PackOutput } from '../report/text'

function usage(key: string, params?: Record<string, string | number>): UsageError {
  return new UsageError(t('zh', key, params), t('en', key, params))
}

function realOrResolved(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** --out 的解析（plan §4.6 pack 第 5 步）：已有文件夹 → 放进去；.zip 结尾 → 就是它，上级要存在；不能落在扩展的子文件夹里 */
export function resolveOut(root: string, out: string | undefined, cwd: string, name: string): string {
  let target: string
  if (out === undefined) {
    target = join(cwd, name)
  } else {
    const abs = resolve(cwd, out)
    if (isDir(abs)) {
      target = join(abs, name)
    } else if (/\.zip$/i.test(abs)) {
      if (!isDir(dirname(abs))) throw usage('err.outParent', { path: dirname(abs) })
      target = abs
    } else {
      throw usage('err.outNotZip', { path: abs })
    }
  }
  const rel = relative(realOrResolved(root), join(realOrResolved(dirname(target)), basename(target)))
  const inside = rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
  if (inside && rel.includes(sep)) throw usage('err.outInside', { path: target })
  return target
}

const ENGINE_CODES: readonly string[] = EXT_ENGINE_CODES

/** 问题的比较键：代码、严重度、范围、路径、贡献位置，不含文案；引擎的问题不比 */
function issueKeys(issues: ExtPackIssue[]): string[] {
  return issues
    .filter(i => !ENGINE_CODES.includes(i.code))
    .map(i =>
      [
        i.code,
        i.severity,
        i.scope,
        i.path ?? '',
        i.contribution ? `${i.contribution.kind}[${i.contribution.index}]` : '',
        i.upload ?? '',
      ].join('|'),
    )
    .sort()
}

/** 打完包读回来再查一遍，结果必须和查文件夹时一样；返回第一处不同，一样则 null */
function readBackDiff(folder: ExtPackCheck, zip: ExtPackCheck): string | null {
  if (folder.id !== zip.id) return `id ${String(folder.id)} / ${String(zip.id)}`
  if (folder.files.size !== zip.files.size) return `files ${folder.files.size} / ${zip.files.size}`
  for (const [path, size] of folder.files) {
    if (zip.files.get(path) !== size) return `file ${path}`
  }
  const a = issueKeys(folder.issues)
  const b = issueKeys(zip.issues)
  const n = Math.max(a.length, b.length)
  for (let k = 0; k < n; k++) if (a[k] !== b[k]) return `issue ${a[k] ?? '-'} / ${b[k] ?? '-'}`
  return null
}

function print(p: ParsedCli, io: CliIo, report: CheckReport, output?: PackOutput): void {
  if (p.json) io.out(JSON.stringify(toJson(report, { command: 'pack', output: output ?? null }), null, 2) + '\n')
  else io.out(renderText(report, { lang: p.lang, color: p.color, command: 'pack', output }))
}

export async function runPack(p: ParsedCli, io: CliIo, hooks: CliHooks = {}): Promise<number> {
  const root = resolve(io.cwd, p.path)
  let st
  try {
    st = statSync(root)
  } catch {
    throw new UsageError(`路径不存在：${root}`, `Path does not exist: ${root}`)
  }
  if (!st.isDirectory()) throw usage('err.packNeedsFolder', { path: root })
  // 先把 --out 的用法错误挑出来（文件名还没定，先用占位名）
  resolveOut(root, p.out, io.cwd, 'x.zip')

  const run = hooks.checkInput ?? checkInput
  const report = await run(root, { level: 'upload', grammar: p.grammar, strict: p.strict, runner: hooks.runner })
  if (!report.verdict.pass) {
    print(p, io, report)
    return 1
  }

  const files = report.files
  const paths = [...report.check.files.keys()].sort()
  const bytes = writePackZip(files, paths)
  if (bytes.length > EXT_LIMITS.packBytes) {
    const issues = [...report.check.issues, zipIssue('zip.tooLarge', { detail: `${bytes.length} bytes` })]
    const failed: CheckReport = {
      ...report,
      check: { ...report.check, issues, status: 'error' },
      verdict: checkVerdict(issues, { level: 'upload', strict: p.strict }),
    }
    print(p, io, failed)
    return 1
  }

  const diff = readBackDiff(
    checkPack(files, { source: 'folder', grammar: [] }),
    checkPack(readPackZip(bytes), { source: 'folder', grammar: [] }),
  )
  if (diff !== null)
    throw new ToolError(t('zh', 'err.packMismatch', { detail: diff }), t('en', 'err.packMismatch', { detail: diff }))

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const listed = paths.map(path => ({ path, size: report.check.files.get(path) ?? 0 }))
  if (p.dryRun) {
    print(p, io, report, { path: null, bytes: bytes.length, sha256, files: listed, dryRun: true })
    return 0
  }

  const m = report.check.manifest!
  const target = resolveOut(root, p.out, io.cwd, `${m.id}-${m.version}.zip`)
  const tmp = `${target}.tmp-${process.pid}`
  try {
    const write = hooks.writeFile ?? ((f: string, b: Uint8Array) => writeFile(f, b))
    await write(tmp, bytes)
    await rename(tmp, target)
  } catch (e) {
    await unlink(tmp).catch(() => undefined)
    const detail = e instanceof Error ? e.message : String(e)
    throw new ToolError(t('zh', 'err.writeFailed', { detail }), t('en', 'err.writeFailed', { detail }))
  }
  print(p, io, report, { path: target, bytes: bytes.length, sha256, files: listed, dryRun: false })
  return 0
}
