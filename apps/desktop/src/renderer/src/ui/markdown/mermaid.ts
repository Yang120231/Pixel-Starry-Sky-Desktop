// 回复里的 Mermaid 图表（docs/ui/mermaid.md）：mermaid 按需动态导入（写法同 math.ts），只在遇到 mermaid 代码块时加载。
// 渲染结果是 SVG 字符串，用 <img src="data:image/svg+xml"> 显示（CSP 允许 data:），不插进页面 DOM。
import { useEffect, useState } from 'react'

type Mermaid = typeof import('mermaid').default

export type Rgb = readonly [number, number, number]

let loading: Promise<Mermaid> | null = null

/** 加载 mermaid（只加载一次）；加载失败下次再试 */
export function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then(
    m => m.default,
    (e: unknown) => {
      loading = null
      throw e
    },
  )
  return loading
}

const hex = (c: Rgb): string => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

/** a 占 pct%、b 占其余，混合后的颜色（节点的浅底色，同设计稿 color-mix） */
export const mix = (a: Rgb, b: Rgb, pct: number): Rgb =>
  [0, 1, 2].map(i => a[i] * (pct / 100) + b[i] * (1 - pct / 100)) as unknown as Rgb

const luminance = ([r, g, b]: Rgb): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255

/** 设计变量 → mermaid base 主题的 themeVariables；color 取设计变量解析后的颜色 */
export function mermaidThemeVars(color: (name: string) => Rgb, fontFamily: string): Record<string, string | boolean> {
  const surface = color('--bg-surface')
  const text = color('--text')
  const tint = (name: string, pct = 10): string => hex(mix(color(name), surface, pct))
  return {
    darkMode: luminance(surface) < 0.5,
    background: hex(surface),
    fontFamily,
    fontSize: '13px',
    textColor: hex(text),
    lineColor: hex(color('--text-muted')),
    mainBkg: hex(surface),
    nodeBorder: hex(color('--border-strong')),
    nodeTextColor: hex(text),
    primaryColor: tint('--accent'),
    primaryBorderColor: hex(color('--accent')),
    primaryTextColor: hex(text),
    secondaryColor: tint('--active'),
    secondaryBorderColor: hex(color('--active')),
    secondaryTextColor: hex(text),
    tertiaryColor: tint('--success', 12),
    tertiaryBorderColor: hex(color('--success')),
    tertiaryTextColor: hex(text),
    clusterBkg: hex(mix(text, surface, 4)),
    clusterBorder: hex(color('--border')),
    edgeLabelBackground: hex(surface),
    titleColor: hex(text),
    noteBkgColor: tint('--warn', 12),
    noteBorderColor: hex(color('--warn')),
    noteTextColor: hex(text),
    errorBkgColor: tint('--danger'),
    errorTextColor: hex(color('--danger')),
  }
}

let probe: CanvasRenderingContext2D | null = null

/** 设计变量 → 颜色（含 color-mix）：先让浏览器算出变量的值，再借 canvas 取像素 */
function resolveColor(name: string): Rgb {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000'
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

/** 读当前主题的 themeVariables（浏览器里才能调） */
export const readThemeVars = (): Record<string, string | boolean> =>
  mermaidThemeVars(resolveColor, getComputedStyle(document.body).fontFamily)

/** 当前主题的 themeVariables；<html> 的属性变了（主题、配色、强调色）就重新读，值变了才更新 */
export function useThemeVars(): Record<string, string | boolean> {
  const [vars, setVars] = useState<Record<string, string | boolean>>(() =>
    typeof document === 'undefined' ? {} : readThemeVars(),
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = readThemeVars()
      setVars(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])
  return vars
}

/**
 * mermaid 给的 SVG 宽度是 100%（只有 viewBox）：<img> 和「复制图片」没有固有尺寸。
 * 把根节点的 width / height 换成 viewBox 的宽高，去掉 max-width 的内联样式。
 */
export function sizeSvg(svg: string, background?: string): string {
  return svg.replace(/<svg\b[^>]*>/, tag => {
    const box = /viewBox="[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(tag)
    if (!box) return tag
    // 加底色：放大弹层的遮罩是半透明的，透明底的图后面会透出页面；复制成 PNG 也不会是透明底
    const rest = tag.replace(/\s(?:width|height|style)="[^"]*"/g, '')
    const style = background ? ` style="background-color:${background}"` : ''
    return rest.replace('<svg', `<svg width="${Math.ceil(+box[1])}" height="${Math.ceil(+box[2])}"${style}`)
  })
}

export const svgDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** 错误原因：mermaid 的解析错误带「Parse error on line N」，最后一行是期望什么、得到什么 */
export function describeMermaidError(e: unknown): { line: number | null; reason: string } {
  const message = (e instanceof Error ? e.message : String(e)).trim()
  const lines = message
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  const line = /line (\d+)/i.exec(message)
  // 词法错误（Lexical error on line N. Unrecognized text.）的最后一行只是脱字符指示行，原因在第一行
  const last = lines[lines.length - 1]
  const useLast = line && !/^-*\^$/.test(last ?? '')
  return { line: line ? +line[1] : null, reason: (useLast ? last : lines[0]) || message }
}

// mermaid.render 同时跑几个会互相抢全局配置：串行排队
let queue: Promise<unknown> = Promise.resolve()
let seq = 0

/** 画图：先 parse（语法错不碰页面），再 render；失败清掉 mermaid 留在 body 里的临时节点 */
export function renderMermaid(code: string, themeVariables: Record<string, string | boolean>): Promise<string> {
  const run = async (): Promise<string> => {
    const mermaid = await loadMermaid()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables,
      htmlLabels: false,
      suppressErrorRendering: true,
    })
    await mermaid.parse(code)
    const id = `mermaid-${++seq}`
    try {
      return sizeSvg((await mermaid.render(id, code)).svg, themeVariables.background as string)
    } finally {
      document.getElementById(`d${id}`)?.remove()
    }
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
