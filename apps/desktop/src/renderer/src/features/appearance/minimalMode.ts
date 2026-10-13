/** 极简模式（参考 Factory，docs/ui/minimal-mode.md）：开了写 <html data-minimal="on">，样式全在 styles/minimal.css */
export type MinimalMode = 'on' | 'off'
export const MINIMAL_MODE_KEY = 'pixelsky.minimal'
export const DEFAULT_MINIMAL_MODE: MinimalMode = 'off'

export function parseMinimalMode(value: unknown): MinimalMode {
  return value === 'on' || value === 'off' ? value : DEFAULT_MINIMAL_MODE
}

export function readMinimalMode(): MinimalMode {
  try {
    return parseMinimalMode(localStorage.getItem(MINIMAL_MODE_KEY))
  } catch {
    return DEFAULT_MINIMAL_MODE
  }
}
