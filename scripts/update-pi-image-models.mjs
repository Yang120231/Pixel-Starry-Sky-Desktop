#!/usr/bin/env node
// 生成 packages/protocol/src/models/pi-image-models.ts：Pi 内置模型表里官方厂商的模型能不能收图片。
// 设置 › 模型通道 › 自定义接口的「看图 · 自动」按它显示判断结果，和命令行（packages/cli/src/extensions/builtin-models.ts 的
// VENDORS / findBuiltin）用的是同一份表。升级像素星空命令行的 Pi 后跑一次；packages/cli/test/pi-image-models.test.ts 会比对，不一致时提示重跑。
// 用法：node scripts/update-pi-image-models.mjs
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { piImageModels } from './pi-image-models-source.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'packages', 'protocol', 'src', 'models', 'pi-image-models.ts')
const table = piImageModels(root)
const body = Object.keys(table)
  .sort()
  .map(id => `  ${JSON.stringify(id)}: ${table[id]},`)
  .join('\n')
writeFileSync(
  out,
  `// 自动生成，不要手改：node scripts/update-pi-image-models.mjs（来源：像素星空命令行依赖的 Pi 内置模型表）
/** Pi 内置表里官方厂商的模型 id → 能不能收图片 */
export const PI_IMAGE_MODELS: Readonly<Record<string, boolean>> = {
${body}
}
`,
)
execFileSync(process.execPath, [join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', out], {
  stdio: 'ignore',
})
console.log(`已写入 ${out}：${Object.keys(table).length} 个模型`)
