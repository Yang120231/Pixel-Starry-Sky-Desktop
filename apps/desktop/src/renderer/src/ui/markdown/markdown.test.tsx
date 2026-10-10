import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@/i18n/I18nProvider'
import { Markdown } from './Markdown'
import { hasMath, loadMath, normalizeMath } from './math'
import { shouldFold } from '../code/CodeBlock'

const html = (text: string): string =>
  renderToStaticMarkup(
    <I18nProvider>
      <Markdown text={text} />
    </I18nProvider>,
  )

describe('提示块', () => {
  it('五种标记画成提示块，标记本身不显示', () => {
    for (const kind of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      const out = html(`> [!${kind}]\n> 内容 **加粗**`)
      expect(out).toContain(`data-alert="${kind.toLowerCase()}"`)
      expect(out).not.toContain(`[!${kind}]`)
      expect(out).toContain('<strong>加粗</strong>')
    }
  })

  it('标记大小写不敏感，和正文写在同一行也认', () => {
    expect(html('> [!tip] 直接写在后面')).toContain('data-alert="tip"')
  })

  it('普通引用块、标记不在开头的不变', () => {
    expect(html('> 普通引用')).toContain('<blockquote>')
    const out = html('> 说明 [!NOTE] 不在开头')
    expect(out).toContain('<blockquote>')
    expect(out).not.toContain('data-alert')
  })
})

describe('公式标记', () => {
  it('\\( \\) 换成行内 $$，\\[ \\] 换成独占几行的 $$ 块', () => {
    expect(normalizeMath('面积 \\(\\pi r^2\\) 结束')).toBe('面积 $$\\pi r^2$$ 结束')
    expect(normalizeMath('\\[ E = mc^2 \\]')).toBe('\n$$\nE = mc^2\n$$\n')
  })

  it('代码块和行内代码里的不换', () => {
    const text = '`\\(x\\)` 和\n```\n\\[y\\]\n```\n以及 \\(z\\)'
    expect(normalizeMath(text)).toBe('`\\(x\\)` 和\n```\n\\[y\\]\n```\n以及 $$z$$')
  })

  it('加载后渲染成 KaTeX，写错的公式不报错', async () => {
    await loadMath()
    const out = html('行内 \\(a^2+b^2\\) 和\n\n$$\n\\frac{1}{2}\n$$\n\n错的 $$\\frac{$$')
    expect(out).toContain('class="katex"')
    expect(out).toContain('katex-display')
    expect(out).not.toContain('\\(a^2')
  })

  it('单个 $ 不算公式', () => {
    expect(hasMath('价格 $5 和 $10')).toBe(false)
    expect(hasMath('$$x$$')).toBe(true)
    expect(hasMath('\\(x\\)')).toBe(true)
  })
})

describe('长代码块折叠', () => {
  it('超过 30 行才折叠', () => {
    expect(shouldFold(30)).toBe(false)
    expect(shouldFold(31)).toBe(true)
  })

  it('折叠时有展开按钮，复制的仍是全部代码', () => {
    const code = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
    const out = html('```\n' + code + '\n```')
    expect(out).toContain('aria-expanded="false"')
    expect(out).toContain('line 40')
  })
})
