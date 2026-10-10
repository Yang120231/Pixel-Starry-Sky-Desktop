// 数学公式（docs/ui/content-highlight.md §2 I）：只认 $$…$$、\(…\)、\[…\]，单个 $ 不算（用户选择，避免价格被误识别）。
// KaTeX 和它的样式、字体按需加载：文字里出现公式标记时才动态导入，主程序不变大。
import { useEffect, useSyncExternalStore } from 'react'
import type { Options } from 'react-markdown'

export type PluggableList = NonNullable<Options['remarkPlugins']>

/** 有公式标记（$$、\(、\[）才需要加载；代码里的也算进来，加载了也不会把代码当公式 */
export const hasMath = (text: string): boolean => /\$\$|\\\(|\\\[/.test(text)

// 代码块、行内代码原样保留，不换公式标记
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/

/**
 * \[…\] 换成独占几行的 $$ 块，\(…\) 换成行内的 $$…$$（remark-math 认的写法）。
 * Markdown 会把 \( 当成转义的括号，所以要在解析之前换。
 */
export function normalizeMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$$${body.trim()}$$`),
    )
    .join('')
}

export interface MathPlugins {
  remark: PluggableList
  rehype: PluggableList
}

let plugins: MathPlugins | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** 加载 KaTeX 插件和样式（只加载一次）；测试里可以直接等它 */
export function loadMath(): Promise<void> {
  if (plugins) return Promise.resolve()
  if (loading) return loading
  loading = Promise.all([import('remark-math'), import('rehype-katex'), import('katex/dist/katex.min.css')])
    .then(([remarkMath, rehypeKatex]) => {
      plugins = {
        remark: [[remarkMath.default, { singleDollarTextMath: false }]],
        // throwOnError: false 写错的公式显示原文并标红；trust: false 不允许公式里的链接和 HTML
        rehype: [[rehypeKatex.default, { throwOnError: false, trust: false, strict: 'ignore' }]],
      }
      listeners.forEach(l => l())
    })
    .catch(() => {
      // 加载失败就按普通文字显示，下次再试
      loading = null
    })
  return loading
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 需要公式时返回 KaTeX 插件；还没加载好时先返回 null（按原文显示），加载好后自动重新渲染 */
export function useMathPlugins(needed: boolean): MathPlugins | null {
  const ready = useSyncExternalStore(
    subscribe,
    () => plugins,
    () => plugins,
  )
  useEffect(() => {
    if (needed) void loadMath()
  }, [needed])
  return needed ? ready : null
}
