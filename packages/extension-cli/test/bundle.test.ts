import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// build.mjs 是普通 JS，没有类型声明
// @ts-expect-error 无类型声明的 .mjs
import { build } from '../scripts/build.mjs'
import { CORPUS_DIR, REPO_ROOT } from '../src/testing/corpus'

const scratch = join(REPO_ROOT, 'scratch', `extcli-bundle-${process.pid}`)
const bundle = join(scratch, 'pixelsky-ext.mjs')
const dotenv = join(CORPUS_DIR, 'bases', 'pixelsky.dotenv')

/** 在干净的环境里跑打包出来的 CLI（去掉 Claude Code 注入的两个会影响进程行为的变量） */
function run(args: string[], env: Record<string, string> = {}) {
  const clean: NodeJS.ProcessEnv = { ...process.env, ...env }
  delete clean.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  delete clean.NoDefaultCurrentDirectoryInExePath
  const r = spawnSync(process.execPath, [bundle, ...args], {
    encoding: 'utf8',
    env: clean,
    cwd: scratch,
    timeout: 45_000,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

beforeAll(async () => {
  mkdirSync(scratch, { recursive: true })
  await build({ outfile: bundle, quiet: true })
}, 60_000)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('打包后的 pixelsky-ext', () => {
  it('--version 打印工具和规则版本', () => {
    const r = run(['--version'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/pixelsky-ext/)
  })

  it('validate 作者示例：退出 0、没有问题、语法在 worker 里测过（5000 行）', { timeout: 60_000 }, () => {
    const r = run(['validate', dotenv, '--json'])
    expect(r.status, r.stderr).toBe(0)
    const out = JSON.parse(r.stdout) as {
      issues: unknown[]
      verdict: { pass: boolean }
      grammar: { grammars: Array<{ samples: Array<{ lines: number }> }> }
    }
    expect(out.issues).toEqual([])
    expect(out.verdict.pass).toBe(true)
    expect(out.grammar.grammars[0].samples[0].lines).toBe(5000)
  })

  it('pack 两次得到逐字节相同的 zip（7 个文件），validate 这个 zip 通过', { timeout: 60_000 }, () => {
    const a = join(scratch, 'out-a')
    const b = join(scratch, 'out-b')
    mkdirSync(a)
    mkdirSync(b)
    const r1 = run(['pack', dotenv, '--out', a, '--json'])
    const r2 = run(['pack', dotenv, '--out', b, '--json'])
    expect(r1.status, r1.stderr + r1.stdout).toBe(0)
    expect(r2.status, r2.stderr + r2.stdout).toBe(0)
    const o1 = (JSON.parse(r1.stdout) as { output: { path: string; sha256: string; files: unknown[] } }).output
    const o2 = (JSON.parse(r2.stdout) as { output: { path: string; sha256: string; files: unknown[] } }).output
    expect(o1.files).toHaveLength(7)
    expect(o1.sha256).toBe(o2.sha256)
    expect(sha256(o1.path)).toBe(sha256(o2.path))
    expect(sha256(o1.path)).toBe(o1.sha256)
    expect(readdirSync(a)).toEqual(['pixelsky.dotenv-1.0.0.zip'])
    const v = run(['validate', o1.path, '--json'])
    expect(v.status, v.stderr + v.stdout).toBe(0)
    expect((JSON.parse(v.stdout) as { issues: unknown[] }).issues).toEqual([])
  })

  it('用法错误退出 2；检查不通过退出 1', { timeout: 60_000 }, () => {
    expect(run(['validate', dotenv, '--level', 'bogus']).status).toBe(2)
    expect(run(['validate', join(scratch, 'no-such-folder')]).status).toBe(2)
    expect(run(['validate', join(CORPUS_DIR, 'bases', 'unsafe-svg'), '--grammar', 'off']).status).toBe(1)
  })

  it('回溯爆炸的语法：到点就当卡死，报 grammar.hang，退出 1', { timeout: 60_000 }, () => {
    const dir = join(scratch, 'hang-pack')
    cpSync(dotenv, dir, { recursive: true })
    writeFileSync(
      join(dir, 'syntaxes', 'dotenv.tmLanguage.json'),
      JSON.stringify({ scopeName: 'source.dotenv', patterns: [{ match: '(a+)+$', name: 'keyword.hang.dotenv' }] }),
    )
    const line = `${'a'.repeat(40)}b`
    writeFileSync(join(dir, 'samples', 'example.env'), `${Array.from({ length: 40 }, () => line).join('\n')}\n`)
    const started = Date.now()
    const r = run(['validate', dir, '--json'], { PIXELSKY_EXT_HANG_MS: '1500' })
    expect(Date.now() - started).toBeLessThan(40_000)
    expect(r.status, r.stderr + r.stdout).toBe(1)
    const out = JSON.parse(r.stdout) as { issues: Array<{ code: string }> }
    expect(out.issues.map(i => i.code)).toContain('grammar.hang')
  })

  // 1 ms 时卡在编译还是卡在分词取决于机器快慢，两种都要写明上限和文件
  it(
    'PIXELSKY_EXT_HANG_MS 极小：到点就卡死，文字输出里写明上限和文件；编译卡死时语法行是「没有检查」',
    { timeout: 60_000 },
    () => {
      const zh = run(['validate', dotenv, '--no-color'], { PIXELSKY_EXT_HANG_MS: '1' })
      expect(zh.status, zh.stderr + zh.stdout).toBe(1)
      expect(zh.stdout).toMatch(
        /分词超过 1 毫秒还没完成，可能有回溯爆炸的正则（(示例 samples\/example\.env|语法文件 syntaxes\/dotenv\.tmLanguage\.json)）/,
      )
      if (zh.stdout.includes('语法文件 syntaxes')) expect(zh.stdout).toContain('没有检查（编译超时或失败）')
      expect(zh.stdout).toContain('grammar.hang')
      const en = run(['validate', dotenv, '--no-color', '--lang', 'en'], { PIXELSKY_EXT_HANG_MS: '1' })
      expect(en.stdout).toContain('Tokenizing did not finish within 1 ms; a regex may backtrack catastrophically')
    },
  )
})
