// 像素星空引擎经网关（云端线路、自定义 API）时的上下文窗口（docs/own-cli.md §13）：Pi 对不认识的模型一律按 128K 算，
// 网关模型都是它不认识的名字。云端线路在设置 › 模型通道里给这个模型填了窗口就用填的（自定义 API 的在接口配置里）；
// 没填按模型系列自动定，官方价格表里这个模型的窗口更小（老模型，如 claude-haiku-4-5 只有 200K）时取小的。
// 自动定的是「猜的」：命令行在 Pi 内置表里找到同名模型时以内置的为准（packages/cli/src/extensions/builtin-models.ts）
import { officialPrice, type ContextWindows, type SessionRecord } from '@pixelsky/protocol'

/** 按模型名认系列：用户定的（2026-10-21）Claude、DeepSeek 1M，Codex（GPT）、Grok 500K；其余不认，交给 Pi 的默认值 */
export const PIXEL_FAMILY_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/claude/i, 1_000_000],
  [/deepseek/i, 1_000_000],
  [/grok/i, 500_000],
  [/gpt|codex|^o\d/i, 500_000],
]

/** 没填窗口时按系列自动定的；认不出系列为 null */
export function pixelAutoWindow(model: string): number | null {
  const family = PIXEL_FAMILY_WINDOWS.find(([re]) => re.test(model))?.[1]
  if (family === undefined) return null
  const official = officialPrice(model)?.contextWindow ?? null
  return official ? Math.min(family, official) : family
}

/**
 * 这个会话里一个网关模型（接口配置里没写窗口的）要告诉 Pi 的窗口；auto 为真是按系列猜的。
 * 只管经网关的会话（本机模型 Pi 自己认得）；null 表示不改
 */
export function pixelWindow(
  record: Pick<SessionRecord, 'platform' | 'provider'>,
  model: string,
  windows?: ContextWindows,
): { window: number; auto: boolean } | null {
  if (!model || !(record.platform || record.provider)) return null
  const set = record.platform ? windows?.platform[model] : undefined
  if (set) return { window: set, auto: false }
  const auto = pixelAutoWindow(model)
  return auto ? { window: auto, auto: true } : null
}
