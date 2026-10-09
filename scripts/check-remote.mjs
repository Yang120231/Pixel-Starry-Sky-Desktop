// 远端辅助进程（helper.cjs）构建检查：不得依赖 electron，不得打包 renderer / preload 源码
// 构建输出到 scratch/ 下的临时目录，结束后删除
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktop = join(root, 'apps', 'desktop')
const scratchDir = join(root, 'scratch')

// 日期 + 进程号，避免和其他检查冲突
const today = new Date().toISOString().slice(0, 10)
const outName = `${today}-check-remote-${process.pid}`
const outDir = join(scratchDir, outName)

const FORBIDDEN = [
  { pattern: /require\(\s*["']electron["']\s*\)/, message: '产物中出现 require("electron")' },
  { pattern: /[\\/]renderer[\\/]/, message: '产物中出现 renderer/ 源码路径' },
  { pattern: /[\\/]preload[\\/]/, message: '产物中出现 preload/ 源码路径' },
]

async function findCjs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await findCjs(path)))
    else if (entry.name.endsWith('.cjs')) files.push(path)
  }
  return files
}

async function main() {
  // 不经过 pnpm，直接调用 electron-vite 的入口
  const result = spawnSync(
    process.execPath,
    [
      join(desktop, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      'build',
      '--config',
      'electron.remote.config.ts',
      '--outDir',
      outDir,
    ],
    { cwd: desktop, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.log(`远端辅助进程构建失败（退出码 ${result.status}）`)
    console.log((result.stdout || '') + (result.stderr || ''))
    return 1
  }

  const cjsFiles = await findCjs(outDir)
  if (cjsFiles.length === 0) {
    console.log(`未在 ${outName} 中找到 .cjs 产物`)
    return 1
  }

  const problems = []
  for (const file of cjsFiles) {
    const code = await fs.readFile(file, 'utf8')
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(code)) problems.push(`${file}: ${rule.message}`)
    }
  }

  if (problems.length > 0) {
    console.log(problems.join('\n'))
    return 1
  }
  console.log(`OK（检查了 ${cjsFiles.length} 个 .cjs 产物）`)
  return 0
}

let code = 1
try {
  code = await main()
} catch (error) {
  console.log(error.message)
} finally {
  await fs.rm(outDir, { recursive: true, force: true })
}
process.exit(code)
