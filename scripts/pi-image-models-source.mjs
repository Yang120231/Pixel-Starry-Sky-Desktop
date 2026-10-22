// 从像素星空命令行依赖的 Pi（pi-ai 的 providers/data/*.json）读出官方厂商的模型能不能收图片。
// update-pi-image-models.mjs 生成表、packages/cli/test/pi-image-models.test.ts 比对都用它。厂商列表和 packages/cli/src/extensions/builtin-models.ts 的 VENDORS 一致
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const VENDORS = [
  'anthropic',
  'openai',
  'openai-codex',
  'deepseek',
  'xai',
  'google',
  'zai',
  'moonshotai',
  'mistral',
]

/** pi-ai 的 providers/data 目录：pnpm 把它放在 pi-coding-agent 旁边 */
export function piDataDir(root) {
  const agent = realpathSync(join(root, 'packages', 'cli', 'node_modules', '@earendil-works', 'pi-coding-agent'))
  const dir = join(dirname(agent), 'pi-ai', 'dist', 'providers', 'data')
  if (!existsSync(dir)) throw new Error('找不到 Pi 的模型表：' + dir)
  return dir
}

/** { 模型 id: 能不能收图片 }；同一个 id 在几个厂商、几种协议下出现时，有一个能收就算能 */
export function piImageModels(root) {
  const dir = piDataDir(root)
  const files = new Set(readdirSync(dir))
  const table = {}
  for (const vendor of VENDORS) {
    if (!files.has(vendor + '.json')) continue
    const data = JSON.parse(readFileSync(join(dir, vendor + '.json'), 'utf8'))
    for (const byApi of Object.values(data))
      for (const model of Object.values(byApi)) {
        if (!model || typeof model.id !== 'string') continue
        const image = Array.isArray(model.input) && model.input.includes('image')
        table[model.id] = (table[model.id] ?? false) || image
      }
  }
  return table
}
