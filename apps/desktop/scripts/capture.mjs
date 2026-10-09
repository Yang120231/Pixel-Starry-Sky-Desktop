// 截图：按参考图尺寸（1568 × 765）截浅色、深色两张图到 docs/screenshots/
// 用法：
//   pnpm capture        空界面 → phase1-workbench-light.png / -dark.png
//   pnpm capture:demo   演示数据 → phase1-workbench-demo-light.png / -dark.png
// 可选参数：--out <目录>（默认 docs/screenshots）
import { spawnSync } from 'node:child_process'
import { mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const args = process.argv.slice(2)
const demo = args.includes('--demo')
const outIndex = args.indexOf('--out')
const outDir = resolve(outIndex >= 0 ? args[outIndex + 1] : join(appDir, '../../docs/screenshots'))
const prefix = demo ? 'phase1-workbench-demo-' : 'phase1-workbench-'
const electron = createRequire(import.meta.url)('electron')

const tmp = mkdtempSync(join(tmpdir(), 'pixelsky-capture-'))
// 从另一个 Electron 应用（如 Mirasim）的终端启动时会继承 ELECTRON_RUN_AS_NODE，必须去掉
const env = { ...process.env, PIXELSKY_CAPTURE: tmp, PIXELSKY_DEMO: demo ? '1' : '0' }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, [appDir], { stdio: 'inherit', env })
if (result.status !== 0) process.exit(result.status ?? 1)

mkdirSync(outDir, { recursive: true })
for (const theme of ['light', 'dark']) {
  const target = join(outDir, `${prefix}${theme}.png`)
  copyFileSync(join(tmp, `${theme}.png`), target)
  console.log('saved', target)
}
rmSync(tmp, { recursive: true, force: true })
