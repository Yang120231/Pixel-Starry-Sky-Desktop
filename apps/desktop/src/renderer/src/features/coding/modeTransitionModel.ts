// 「对话 | 代码」切换动画（docs/ui/mode-transition.md）：选项解析和「这次要不要播」，纯逻辑
export type ModeTransition = 'slide' | 'fade' | 'off'
export const MODE_TRANSITION_KEY = 'pixelsky.mode-transition'
export const DEFAULT_MODE_TRANSITION: ModeTransition = 'slide'

export function parseModeTransition(value: unknown): ModeTransition {
  return value === 'slide' || value === 'fade' || value === 'off' ? value : DEFAULT_MODE_TRANSITION
}

/**
 * 这次切换播哪种动画；null 是直接切。
 * motion 是 <html data-motion> 的值（设置 › 外观 › 动画）：关闭、或跟随系统且系统要求减少动态效果时不播；
 * 浏览器没有 View Transitions 时也不播
 */
export function transitionFor(
  choice: ModeTransition,
  motion: string | undefined,
  systemReduced: boolean,
  supported: boolean,
): Exclude<ModeTransition, 'off'> | null {
  if (choice === 'off' || !supported) return null
  if (motion === 'off' || (motion === 'system' && systemReduced)) return null
  return choice
}
