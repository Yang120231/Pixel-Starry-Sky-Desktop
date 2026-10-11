// 打包后（electron-builder 的 afterPack）：macOS 上 node-pty 的 spawn-helper 必须能执行，
// 不然终端一打开就报 posix_spawnp failed。npm 包里的权限有时会丢，这里统一补上
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = readdirSync(context.appOutDir).find(name => name.endsWith('.app'))
  if (!app) return
  const prebuilds = join(context.appOutDir, app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds')
  if (!existsSync(prebuilds)) throw new Error('没找到 node-pty 的预编译文件：' + prebuilds)
  for (const dir of readdirSync(prebuilds)) {
    const helper = join(prebuilds, dir, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
