// 统一检查入口（无依赖，不经过 pnpm）
// 用法：node scripts/check.mjs [--fast] [--strict] [--remote] [--build] [--only <步骤名>]
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const has = flag => args.includes(flag)
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined
const strict = has('--strict')

const desktop = join(root, 'apps', 'desktop')
const engine = join(root, 'packages', 'engine')
const protocol = join(root, 'packages', 'protocol')
const tsc = (cwd, project) => ({
  cwd,
  script: join(cwd, 'node_modules', 'typescript', 'bin', 'tsc'),
  args: ['--noEmit', '-p', project],
})
const vitest = (cwd, extra = []) => ({
  cwd,
  script: join(cwd, 'node_modules', 'vitest', 'vitest.mjs'),
  args: ['run', ...extra],
})

const buildDir = join(root, 'scratch', `${new Date().toISOString().slice(0, 10)}-check-build-${process.pid}`)

// group：fast 只跑 tsc 和 docs
const steps = [
  { name: 'tsc:desktop-web', group: 'tsc', ...tsc(desktop, 'tsconfig.web.json') },
  { name: 'tsc:desktop-node', group: 'tsc', ...tsc(desktop, 'tsconfig.node.json') },
  { name: 'tsc:engine', group: 'tsc', ...tsc(engine, 'tsconfig.json') },
  { name: 'tsc:protocol', group: 'tsc', ...tsc(protocol, 'tsconfig.json') },
  { name: 'test:desktop', group: 'test', ...vitest(desktop, ['src/renderer/src', 'src/main', '--root', '.']) },
  { name: 'test:engine', group: 'test', ...vitest(engine) },
  { name: 'test:protocol', group: 'test', ...vitest(protocol) },
  { name: 'docs', group: 'docs', cwd: root, script: join(root, 'scripts', 'check-docs.mjs'), args: [] },
  {
    name: 'eslint',
    group: 'lint',
    optional: true,
    cwd: root,
    script: join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
    args: ['.'],
  },
  {
    name: 'prettier',
    group: 'lint',
    optional: true,
    cwd: root,
    script: join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
    args: ['--check', '.'],
  },
  { name: 'remote', group: 'remote', cwd: root, script: join(root, 'scripts', 'check-remote.mjs'), args: [] },
  {
    name: 'build',
    group: 'build',
    cwd: desktop,
    script: join(desktop, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
    args: ['build', '--outDir', buildDir],
    cleanup: () => rmSync(buildDir, { recursive: true, force: true }),
  },
]

const selected = steps.filter(step => {
  if (only) return step.name === only || step.group === only
  if (step.group === 'remote') return has('--remote')
  if (step.group === 'build') return has('--build')
  if (has('--fast')) return step.group === 'tsc' || step.group === 'docs'
  return true
})

if (only && selected.length === 0) {
  console.error(`未知步骤：${only}（可用：${[...new Set(steps.flatMap(s => [s.name, s.group]))].join(', ')}）`)
  process.exit(2)
}

// 子进程环境去掉 ELECTRON_RUN_AS_NODE
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const run = step =>
  new Promise(done => {
    const child = spawn(process.execPath, [step.script, ...step.args], {
      cwd: step.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.on('error', error => done({ code: 1, output: output + String(error) }))
    child.on('close', code => done({ code: code ?? 1, output }))
  })

const seconds = start => `${((Date.now() - start) / 1000).toFixed(1)}s`
const failed = []
const skipped = []

for (const step of selected) {
  if (step.optional && !existsSync(step.script)) {
    if (strict) {
      console.log(`✗ ${step.name}  未安装（--strict）`)
      failed.push(step.name)
    } else {
      console.log(`- ${step.name}  跳过（未安装）`)
      skipped.push(step.name)
    }
    continue
  }
  const start = Date.now()
  const result = await run(step)
  step.cleanup?.()
  if (result.code === 0) {
    console.log(`✓ ${step.name}  ${seconds(start)}`)
  } else {
    console.log(`✗ ${step.name}  ${seconds(start)}`)
    // 失败时只展示输出末尾，避免刷屏
    const lines = result.output.trimEnd().split('\n')
    console.log(
      lines
        .slice(-40)
        .map(line => `    ${line}`)
        .join('\n'),
    )
    failed.push(step.name)
  }
}

console.log('')
if (skipped.length) {
  console.log(`跳过：${skipped.join('、')}。安装命令：`)
  console.log(
    '  pnpm add -Dw prettier@3.6.2 eslint@9.36.0 @eslint/js@9.36.0 typescript-eslint@8.44.0 eslint-plugin-react-hooks@5.2.0 globals@16.4.0 typescript@5.9.3',
  )
}
if (failed.length) {
  console.log(`失败 ${failed.length} 项：${failed.join('、')}`)
  process.exit(1)
}
console.log('全部通过')
