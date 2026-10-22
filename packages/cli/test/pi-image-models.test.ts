// 设置页「看图 · 自动」（packages/protocol/src/models/image-input.ts）要和命令行真正用的一致：
// 生成的表等于现在依赖的 Pi 内置表；同一批模型名，findBuiltin 找到的模型能不能看图和设置页判断的一样
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findBuiltin } from '../src/extensions/builtin-models.ts'
import { autoImageInput } from '../../protocol/src/models/image-input.ts'
import { PI_IMAGE_MODELS } from '../../protocol/src/models/pi-image-models.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
type Source = { piDataDir(root: string): string; piImageModels(root: string): Record<string, boolean> }
const source = (await import(
  /* @vite-ignore */ new URL('../../../scripts/pi-image-models-source.mjs', import.meta.url).href
)) as Source

/** Pi 内置表里的全部模型（和命令行 session_start 时 modelRegistry.getAll() 一样的来源） */
function allModels(): Record<string, unknown>[] {
  const dir = source.piDataDir(root)
  return readdirSync(dir).flatMap(file =>
    Object.values(JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, Record<string, object>>).flatMap(
      byApi => Object.values(byApi) as Record<string, unknown>[],
    ),
  )
}

describe('看图的自动判断和命令行一致', () => {
  it('生成的表等于现在依赖的 Pi（不一致时跑 node scripts/update-pi-image-models.mjs）', () => {
    expect({ ...PI_IMAGE_MODELS }).toEqual(source.piImageModels(root))
  })

  it('内置表能找到的名字：设置页和命令行判断一样', () => {
    const all = allModels()
    const ids = [
      'grok-4.7',
      'grok-4.7-fast-reasoning',
      'xai/grok-4.7',
      'claude-sonnet-4-6[1m]',
      'claude-haiku-4-5-20251001',
      'gpt-5.5',
      'openai/gpt-5.5',
      'deepseek-v4-pro',
      'kimi-k3',
      'devstral-latest',
      'grok-4',
      'some-relay-model',
    ]
    for (const id of ids) {
      const builtin = findBuiltin(id, 'openai-completions', all)
      const auto = autoImageInput(id, 'chat')
      if (builtin) {
        expect(['builtin', 'prefix'], id).toContain(auto.reason)
        expect(auto.images, id).toBe((builtin.input as string[]).includes('image'))
      } else expect(['vision', 'protocol'], id).toContain(auto.reason)
    }
  })
})
