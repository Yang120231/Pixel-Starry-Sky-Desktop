// 高亮的实现（ui/highlight.ts 按需加载这个文件）：lowlight 的 common（37 种常用语言），转成 React 元素。
import { Fragment, type ReactNode } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { common, createLowlight } from 'lowlight'
import { ALIASES, MAX_LENGTH } from './highlight'

export function createHighlighter(): (code: string, lang: string | null) => ReactNode {
  const lowlight = createLowlight(common)
  return (code, lang) => {
    const key = lang?.trim().toLowerCase()
    const name = key ? (ALIASES[key] ?? key) : null
    if (!name || name === 'plaintext' || !lowlight.registered(name) || code.length > MAX_LENGTH) return code
    try {
      return toJsxRuntime(lowlight.highlight(name, code), { Fragment, jsx, jsxs })
    } catch {
      return code
    }
  }
}
