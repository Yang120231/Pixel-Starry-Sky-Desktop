// 打包后（electron-builder 的 afterPack）：
// 1. 所有平台：补拷 node_modules 并检查像素星空命令行（resources/pixel-cli）是否完整，缺了就让打包失败，不出一个漏了命令行的安装包
// 2. macOS：node-pty 的 spawn-helper 必须能执行，不然终端一打开就报 posix_spawnp failed。npm 包里的权限有时会丢，这里统一补上
const { chmodSync, cpSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

// electron-builder 的 extraResources 不管 filter 怎么写都会丢掉 node_modules 目录（实测），所以 wasm 所在的 node_modules 在这里补拷
const PIXEL_CLI_SRC = join(__dirname, '../../../packages/cli/dist/pixel-cli')

const PIXEL_CLI_FILES = [
  'pixel.mjs',
  'package.json',
  'THIRD_PARTY_NOTICES.txt',
  'LICENSES/pi-coding-agent-MIT.txt',
  'codemode-worker.js',
  'image-resize-worker.js',
  'node_modules/quickjs-wasi/quickjs.wasm',
  'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
]

exports.default = async function afterPack(context) {
  const isMac = context.electronPlatformName === 'darwin'
  const app = isMac ? readdirSync(context.appOutDir).find(name => name.endsWith('.app')) : undefined
  if (isMac && !app) throw new Error('没找到 .app：' + context.appOutDir)
  const resources = isMac ? join(context.appOutDir, app, 'Contents/Resources') : join(context.appOutDir, 'resources')

  if (existsSync(join(PIXEL_CLI_SRC, 'node_modules'))) {
    cpSync(join(PIXEL_CLI_SRC, 'node_modules'), join(resources, 'pixel-cli', 'node_modules'), { recursive: true })
  }
  for (const file of PIXEL_CLI_FILES) {
    const path = join(resources, 'pixel-cli', file)
    if (!existsSync(path))
      throw new Error('安装包里缺少像素星空命令行文件（先 pnpm build，见 packages/cli/scripts/bundle.mjs）：' + path)
  }

  if (!isMac) return
  const prebuilds = join(resources, 'app.asar.unpacked/node_modules/node-pty/prebuilds')
  if (!existsSync(prebuilds)) throw new Error('没找到 node-pty 的预编译文件：' + prebuilds)
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
