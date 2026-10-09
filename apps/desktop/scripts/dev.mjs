// 启动开发模式（electron-vite dev）。
// - 从另一个 Electron 应用（如 Mirasim）的终端启动时会继承 ELECTRON_RUN_AS_NODE，导致 Electron 被当成 Node 运行，这里先去掉。
// - 加 --demo 参数（pnpm dev:demo）时显示演示数据，否则是空界面。
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const demo = args.includes('--demo')
const env = { ...process.env, PIXELSKY_DEMO: demo ? '1' : '0' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn('electron-vite', ['dev', ...args.filter(a => a !== '--demo')], {
  stdio: 'inherit',
  env,
  shell: true,
})
child.on('exit', code => process.exit(code ?? 0))
