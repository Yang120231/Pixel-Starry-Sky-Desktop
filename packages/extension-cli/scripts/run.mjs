// 开发用：先打包再运行 dist/pixelsky-ext.mjs，给根目录的 pnpm ext 用（plan §4.7）
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from './build.mjs'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'pixelsky-ext.mjs')
await build({ quiet: true })
// pnpm 把用户运行命令时所在的文件夹放在 INIT_CWD 里，相对路径才对得上
const r = spawnSync(process.execPath, [dist, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.env.INIT_CWD ?? process.cwd(),
})
if (r.error) {
  console.error(r.error.message)
  process.exit(3)
}
process.exit(r.status ?? 3)
