import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@/i18n/I18nProvider'
import { Markdown } from './Markdown'
import { describeMermaidError, mermaidThemeVars, mix, sizeSvg, svgDataUrl, type Rgb } from './mermaid'

const html = (text: string, streaming = false): string =>
  renderToStaticMarkup(
    <I18nProvider>
      <Markdown text={text} streaming={streaming} />
    </I18nProvider>,
  )

const palette =
  (surface: Rgb, text: Rgb) =>
  (name: string): Rgb =>
    name === '--bg-surface' ? surface : name === '--text' ? text : [100, 150, 200]

describe('Mermaid 主题变量', () => {
  it('混色：占比 pct% 的在前', () => {
    expect(mix([0, 0, 0], [200, 100, 50], 10)).toEqual([180, 90, 45])
  })

  it('浅色底不是 darkMode，深色底是；颜色全是 #rrggbb', () => {
    const light = mermaidThemeVars(palette([255, 255, 255], [32, 33, 31]), 'Inter')
    const dark = mermaidThemeVars(palette([38, 38, 36], [236, 236, 230]), 'Inter')
    expect(light.darkMode).toBe(false)
    expect(dark.darkMode).toBe(true)
    expect(light.background).toBe('#ffffff')
    expect(light.textColor).toBe('#20211f')
    for (const [k, v] of Object.entries(light))
      if (!['darkMode', 'fontFamily', 'fontSize'].includes(k)) expect(v, k).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('Mermaid SVG 处理', () => {
  it('width=100% 换成 viewBox 的宽高，去掉 max-width、加上底色', () => {
    const svg =
      '<svg id="m" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 570px;" viewBox="0 0 569.5 190"><g/></svg>'
    const out = sizeSvg(svg, '#262624')
    expect(out).toContain('width="570" height="190"')
    expect(out).not.toContain('100%')
    expect(out).not.toContain('max-width')
    expect(out).toContain('style="background-color:#262624"')
    expect(out).toContain('<g/>')
  })

  it('没有 viewBox 原样返回；data URL 可还原', () => {
    expect(sizeSvg('<svg width="10"></svg>')).toBe('<svg width="10"></svg>')
    const svg = '<svg><text>中 & "文"</text></svg>'
    const url = svgDataUrl(svg)
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(svg)
  })
})

describe('Mermaid 错误原因', () => {
  it('解析错误取出行号和最后一行', () => {
    const e = new Error(
      "Parse error on line 3:\n...B -- 是 C[渲染\n-----------------------^\nExpecting 'SEMI', got 'NODE_STRING'",
    )
    expect(describeMermaidError(e)).toEqual({ line: 3, reason: "Expecting 'SEMI', got 'NODE_STRING'" })
  })

  it('词法错误最后一行是脱字符指示行，原因取第一行', () => {
    const e = new Error('Lexical error on line 2. Unrecognized text.\n...A --> B，\n-----------------------^')
    expect(describeMermaidError(e)).toEqual({ line: 2, reason: 'Lexical error on line 2. Unrecognized text.' })
  })

  it('别的错误取第一行', () => {
    expect(describeMermaidError(new Error('No diagram type detected\nmore'))).toEqual({
      line: null,
      reason: 'No diagram type detected',
    })
    expect(describeMermaidError('boom')).toEqual({ line: null, reason: 'boom' })
  })
})

describe('回复里的 mermaid 代码块', () => {
  const md = '```mermaid\nflowchart LR\n  A --> B\n```'

  it('流式时按普通源码显示，没有「源码 / 图」切换', () => {
    const out = html(md, true)
    expect(out).toContain('flowchart')
    expect(out).toContain('data-code-lang="mermaid"')
    expect(out).not.toContain('aria-pressed')
  })

  it('写完后带切换和放大，先显示加载占位（图在浏览器里异步画）', () => {
    const out = html(md)
    expect(out).toContain('aria-pressed')
    expect(out).toContain('正在加载图表')
    expect(out).toContain('data-code-lang="mermaid"')
  })

  it('其它语言不受影响', () => {
    expect(html('```ts\nlet a = 1\n```')).not.toContain('aria-pressed')
  })
})
