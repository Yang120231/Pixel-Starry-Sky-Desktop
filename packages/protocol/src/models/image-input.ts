// 像素星空的模型能不能看图（docs/ui/model-image-input-mockup.html）。
// 命令行按协议定默认值（Chat 只收文字），再按 Pi 内置表里的同名模型改（packages/cli/src/extensions/builtin-models.ts）。
// 这里是同一套规则的「自动」判断：设置页显示结果和原因，引擎、子智能体的默认值用 looksVisual 补上名字一看就能看图的。
import { PI_IMAGE_MODELS } from './pi-image-models'

/** 设置里自定义接口的协议 */
export type ImageInputProtocol = 'anthropic' | 'responses' | 'chat'

/** 自动判断的依据：Pi 内置表里有 / 去掉厂商前缀后有 / 名字带 vision、vl / 按协议的默认值 */
export type ImageInputReason = 'builtin' | 'prefix' | 'vision' | 'protocol'

/** 名字一看就是能看图的：带 vision、单独一段 vl（qwen3-vl-plus）、版本号后面紧跟 v（glm-4.5v） */
export function looksVisual(id: string): boolean {
  return /vision|(?:^|[-_./])vl(?:[-_.]|$)|\dv(?:$|[-_])/i.test(id)
}

/** 去掉 xai/、openai/ 这类厂商前缀（中转站常见的写法） */
export function stripVendorPrefix(id: string): string {
  return id.replace(/^[^/]+\//, '')
}

const tokens = (id: string): string[] => id.toLowerCase().split('-').filter(Boolean)

/**
 * Pi 内置表里对应的模型能不能看图；找不到为 null。规则同命令行的 findBuiltin：先按原名、去掉 [1m] 和日期后缀的名字找，
 * 再找同一系列里名字的每一段都在这个名字里的（grok-4.7-fast-reasoning → grok-4.7），取段数最多的
 */
export function piBuiltinImage(id: string, table: Readonly<Record<string, boolean>> = PI_IMAGE_MODELS): boolean | null {
  const bare = id.replace(/\[1m\]$/i, '')
  for (const name of [id, bare, bare.replace(/-\d{8}$/, '')]) if (Object.hasOwn(table, name)) return table[name]!
  const own = new Set(tokens(bare))
  const family = tokens(bare)[0]
  let size = 1
  let found: boolean | null = null
  for (const [name, image] of Object.entries(table)) {
    const parts = tokens(name)
    if (parts[0] !== family || parts.length <= 1 || !parts.every(p => own.has(p))) continue
    if (parts.length > size) {
      size = parts.length
      found = image
    } else if (parts.length === size) found = found || image
  }
  return found
}

/** 「看图 · 自动」的结果和原因 */
export function autoImageInput(
  id: string,
  protocol: ImageInputProtocol,
  table: Readonly<Record<string, boolean>> = PI_IMAGE_MODELS,
): { images: boolean; reason: ImageInputReason } {
  const own = piBuiltinImage(id, table)
  if (own !== null) return { images: own, reason: 'builtin' }
  const bare = stripVendorPrefix(id)
  if (bare !== id) {
    const prefixed = piBuiltinImage(bare, table)
    if (prefixed !== null) return { images: prefixed, reason: 'prefix' }
  }
  if (looksVisual(id)) return { images: true, reason: 'vision' }
  return { images: protocol !== 'chat', reason: 'protocol' }
}
