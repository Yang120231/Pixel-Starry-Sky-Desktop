import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * 像素星空命令行（packages/cli）的入口，传给 EngineHost 的 pixelCli。
 * - 开发：直接用仓库里的源码入口（适配器用 Electron 自带的 node 跑 .ts，需要 Node 的类型剥离）
 * - 打包后：TODO(P3) 安装包把打好的 dist/pixel.mjs 放进 process.resourcesPath（asarUnpack），这里改成返回那个路径；
 *   现在返回 null，只在 PATH 上找 pixelsky，不影响打包
 */
export function bundledPixelCli(): string | null {
  if (app.isPackaged) return null
  const entry = join(app.getAppPath(), '..', '..', 'packages', 'cli', 'src', 'cli.ts')
  return existsSync(entry) ? entry : null
}
