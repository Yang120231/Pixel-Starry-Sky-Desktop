import { Worker } from 'node:worker_threads'
import { EXT_LIMITS, grammarIssue, locateJsonPointer } from '@pixelsky/protocol/extpacks'
import type { ExtPackIssue, ExtPackManifest, ExtPackReader } from '@pixelsky/protocol/extpacks'
import { ToolError } from '../check'
import { collectRegexes, neutralizeBackrefs } from './collect'
import { createTmEngine } from './engine'
import type { TmEngine } from './engine'
import { measureSample } from './measure'
import type { SampleMeasure } from './measure'
import { GRAMMAR_WORKER_KIND } from './worker'

export type GrammarMode = 'full' | 'regex'

export interface GrammarResult {
  index: number
  scopeName: string
  /** null：编译任务超时或崩溃，没有得到数量 */
  regexes: number | null
  samples: SampleMeasure[]
}

/** 可序列化，能送进 worker */
export interface GrammarJob {
  kind: 'compile' | 'perf'
  index: number
  /** compile：这个语法自己的 scopeName；perf：分词用的根语法（纯注入语法用宿主的） */
  scopeName: string
  /** 被检查的语法文件 */
  path: string
  grammars: Array<{ scopeName: string; path: string; text: string; injectTo?: string[] }>
  sample?: { path: string; text: string }
}

type JobOutput = { issues: ExtPackIssue[]; result?: Partial<GrammarResult> | SampleMeasure }

/** 同一个 code 最多报这么多条，剩下的合成一条（和 validate 的 MAX_PER_CODE 一致） */
const MAX_REGEX_ISSUES = 20

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function compileJob(job: GrammarJob, engine: TmEngine): Promise<JobOutput> {
  const self = job.grammars.find(g => g.path === job.path)
  if (!self) return { issues: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(self.text)
  } catch {
    return { issues: [] } // 解析不了静态检查已经报过
  }
  const regexes = collectRegexes(parsed)
  const issues: ExtPackIssue[] = []
  let failed = 0
  for (const r of regexes) {
    const err = engine.compileError(r.kind === 'end' || r.kind === 'while' ? neutralizeBackrefs(r.source) : r.source)
    if (err === null) continue
    failed += 1
    if (failed > MAX_REGEX_ISSUES) continue
    const at = locateJsonPointer(self.text, r.pointer)
    issues.push(
      grammarIssue('grammar.regex', {
        index: job.index,
        path: job.path,
        pointer: r.pointer,
        detail: err,
        line: at?.line,
        column: at?.column,
      }),
    )
  }
  if (failed > MAX_REGEX_ISSUES) {
    const more = failed - MAX_REGEX_ISSUES
    issues.push(
      grammarIssue('grammar.regex', {
        index: job.index,
        path: job.path,
        detail: `还有 ${more} 条正则编译不了 / ${more} more regexes failed to compile`,
      }),
    )
  }
  if (failed === 0) {
    try {
      const tok = await engine.tokenizer(job.scopeName, job.grammars)
      if (!tok) {
        issues.push(
          grammarIssue('grammar.load', { index: job.index, path: job.path, detail: `scopeName ${job.scopeName}` }),
        )
      } else {
        tok.line('', tok.initial, EXT_LIMITS.sampleMs)
      }
    } catch (e) {
      issues.push(grammarIssue('grammar.load', { index: job.index, path: job.path, detail: errText(e) }))
    }
  }
  return { issues, result: { regexes: regexes.length } }
}

async function perfJob(job: GrammarJob, engine: TmEngine, now: () => number): Promise<JobOutput> {
  const sample = job.sample
  if (!sample) return { issues: [] }
  let tok
  try {
    tok = await engine.tokenizer(job.scopeName, job.grammars)
  } catch (e) {
    return { issues: [grammarIssue('grammar.load', { index: job.index, path: job.path, detail: errText(e) })] }
  }
  if (!tok) {
    return {
      issues: [
        grammarIssue('grammar.load', { index: job.index, path: job.path, detail: `scopeName ${job.scopeName}` }),
      ],
    }
  }
  const m = measureSample(tok, sample.text, sample.path, now)
  const issues: ExtPackIssue[] = []
  for (const s of m.slow) {
    issues.push(
      grammarIssue('grammar.slowLine', {
        index: job.index,
        path: sample.path,
        line: s.line,
        ms: s.ms,
        limitMs: EXT_LIMITS.lineMs,
      }),
    )
  }
  const totalSlow = m.totalMs > m.budgetMs
  if (totalSlow) {
    issues.push(
      grammarIssue('grammar.slowTotal', { index: job.index, path: sample.path, ms: m.totalMs, limitMs: m.budgetMs }),
    )
  }
  if (!m.slow.length && !totalSlow && m.slowestMs > EXT_LIMITS.lineMs * EXT_LIMITS.nearRatio) {
    issues.push(
      grammarIssue('grammar.perfNearLimit', {
        index: job.index,
        path: sample.path,
        line: m.slowestLine,
        ms: m.slowestMs,
        limitMs: EXT_LIMITS.lineMs,
      }),
    )
  }
  return { issues, result: m }
}

/** 在当前线程跑一个任务（inline 和 worker 里都用） */
export async function runGrammarJob(job: GrammarJob, engine: TmEngine, now: () => number): Promise<JobOutput> {
  return job.kind === 'compile' ? compileJob(job, engine) : perfJob(job, engine, now)
}

type Outcome = { ok: true; value: JobOutput } | { ok: false; reason: 'hang' | 'crash'; detail?: string }
interface Runner {
  run(job: GrammarJob): Promise<Outcome>
  close(): Promise<void>
}

function inlineRunner(now: () => number): Runner {
  let engine: Promise<TmEngine> | null = null
  return {
    async run(job) {
      try {
        engine ??= createTmEngine().catch(e => {
          throw new ToolError(`语法引擎初始化失败：${errText(e)}`)
        })
        return { ok: true, value: await runGrammarJob(job, await engine, now) }
      } catch (e) {
        if (e instanceof ToolError) throw e
        return { ok: false, reason: 'crash', detail: errText(e) }
      }
    },
    async close() {},
  }
}

type WorkerMsg =
  | { type: 'ready' }
  | { type: 'fatal'; error: string }
  | { type: 'done'; value: JobOutput }
  | { type: 'failed'; error: string }

/** 主线程的硬超时：到点 terminate，下一个任务起新 worker（一个 regex 的回溯 timeLimit 打断不了） */
function workerRunner(url: URL, hangMs: number): Runner {
  let worker: Worker | null = null
  let ready: Promise<void> | null = null

  const start = (): Worker => {
    const w = new Worker(url, { workerData: { kind: GRAMMAR_WORKER_KIND } })
    worker = w
    ready = new Promise<void>((resolve, reject) => {
      const onMsg = (m: WorkerMsg) => {
        if (m.type === 'ready') {
          w.off('message', onMsg)
          resolve()
        } else if (m.type === 'fatal') {
          reject(new ToolError(`语法引擎初始化失败：${m.error}`))
        }
      }
      w.on('message', onMsg)
      w.once('error', e => reject(new ToolError(`语法引擎初始化失败：${errText(e)}`)))
      w.once('exit', () => {
        // 空闲时退出的 worker 不能再复用
        if (worker === w) {
          worker = null
          ready = null
        }
        reject(new ToolError('语法引擎初始化失败：worker 提前退出'))
      })
    })
    ready.catch(() => {})
    return w
  }

  const drop = async (): Promise<void> => {
    const w = worker
    worker = null
    ready = null
    if (w) await w.terminate().catch(() => 0)
  }

  return {
    async run(job) {
      const w = worker ?? start()
      try {
        await ready
      } catch (e) {
        await drop()
        throw e
      }
      return new Promise<Outcome>(resolve => {
        let settled = false
        const finish = (o: Outcome, kill: boolean) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          w.off('message', onMsg)
          w.off('error', onErr)
          w.off('exit', onExit)
          if (kill) void drop().then(() => resolve(o))
          else resolve(o)
        }
        const onMsg = (m: WorkerMsg) => {
          if (m.type === 'done') finish({ ok: true, value: m.value }, false)
          else if (m.type === 'failed') finish({ ok: false, reason: 'crash', detail: m.error }, false)
        }
        const onErr = (e: unknown) => finish({ ok: false, reason: 'crash', detail: errText(e) }, true)
        const onExit = () => finish({ ok: false, reason: 'crash', detail: 'worker 意外退出' }, true)
        const timer = setTimeout(() => finish({ ok: false, reason: 'hang' }, true), hangMs)
        w.on('message', onMsg)
        w.on('error', onErr)
        w.on('exit', onExit)
        w.postMessage({ type: 'job', job })
      })
    },
    close: drop,
  }
}

function resolveHangMs(opt: number | undefined): number {
  if (opt !== undefined) return opt
  // 只给测试用：README 里写明
  const env = Number(process.env['PIXELSKY_EXT_HANG_MS'])
  return Number.isFinite(env) && env > 0 ? env : EXT_LIMITS.hangMs
}

export async function checkGrammars(
  manifest: ExtPackManifest,
  reader: ExtPackReader,
  opts: {
    inactive: number[]
    mode: GrammarMode
    runner: 'inline' | 'worker'
    hangMs?: number
    now?: () => number
    workerUrl?: URL
  },
): Promise<{ issues: ExtPackIssue[]; results: GrammarResult[] }> {
  const now = opts.now ?? (() => performance.now())
  const list = manifest.contributes.grammars ?? []
  const live = list
    .map((g, index) => ({ g, index }))
    .filter(x => !opts.inactive.includes(x.index))
    .flatMap(x => {
      const text = reader.readText(x.g.path)
      if (text === null) return []
      try {
        JSON.parse(text)
      } catch {
        return [] // 解析不了静态检查已经报过
      }
      return [{ ...x, text }]
    })
  const issues: ExtPackIssue[] = []
  const results: GrammarResult[] = []
  if (!live.length) return { issues, results }

  const grammars = live.map(x => ({
    scopeName: x.g.scopeName,
    path: x.g.path,
    text: x.text,
    ...(x.g.injectTo ? { injectTo: x.g.injectTo } : {}),
  }))
  const hangMs = resolveHangMs(opts.hangMs)
  const runner =
    opts.runner === 'worker' ? workerRunner(opts.workerUrl ?? new URL(import.meta.url), hangMs) : inlineRunner(now)

  const exec = async (job: GrammarJob): Promise<JobOutput | null> => {
    const o = await runner.run(job)
    if (o.ok) return o.value
    const path = job.sample?.path ?? job.path
    issues.push(
      o.reason === 'hang'
        ? grammarIssue('grammar.hang', {
            index: job.index,
            path,
            limitMs: hangMs,
            ...(job.sample ? {} : { detail: 'compile' }),
          })
        : grammarIssue('grammar.load', { index: job.index, path: job.path, detail: o.detail }),
    )
    return null
  }

  try {
    for (const x of live) {
      const g = x.g
      const compile = await exec({
        kind: 'compile',
        index: x.index,
        scopeName: g.scopeName,
        path: g.path,
        grammars,
      })
      const result: GrammarResult = { index: x.index, scopeName: g.scopeName, regexes: null, samples: [] }
      results.push(result)
      if (!compile) continue
      issues.push(...compile.issues)
      result.regexes = (compile.result as Partial<GrammarResult> | undefined)?.regexes ?? 0
      if (opts.mode !== 'full' || compile.issues.length) continue

      // 纯注入语法：宿主在本扩展里才能测分词，否则只做了编译
      let root = g.scopeName
      if (!g.language && g.injectTo?.length) {
        const host = live.find(h => h !== x && g.injectTo?.includes(h.g.scopeName))
        if (!host) continue
        root = host.g.scopeName
      }
      for (const samplePath of g.samples ?? []) {
        const text = reader.readText(samplePath)
        if (text === null) continue
        const perf = await exec({
          kind: 'perf',
          index: x.index,
          scopeName: root,
          path: g.path,
          grammars,
          sample: { path: samplePath, text },
        })
        if (!perf) continue
        issues.push(...perf.issues)
        if (perf.result) result.samples.push(perf.result as SampleMeasure)
      }
    }
  } finally {
    await runner.close()
  }
  if (opts.mode === 'regex') issues.push(grammarIssue('grammar.perfUnchecked', { index: 0 }))
  return { issues, results }
}
