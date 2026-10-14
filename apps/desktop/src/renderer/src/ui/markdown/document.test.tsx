import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '@/i18n/I18nProvider'
import { Markdown } from './Markdown'
import { slugify } from './document'

const html = (text: string, document = true): string =>
  renderToStaticMarkup(
    <I18nProvider>
      <Markdown text={text} document={document} />
    </I18nProvider>,
  )

describe('slugify', () => {
  it('小写、去标点、空格换 -', () => {
    expect(slugify('Hello, World!')).toBe('hello-world')
    expect(slugify('API_v2 - notes')).toBe('api_v2---notes')
  })
  it('中文原样保留', () => {
    expect(slugify('常见问题')).toBe('常见问题')
    expect(slugify('快速 开始？')).toBe('快速-开始')
  })
})

describe('文档模式', () => {
  it('标题带 id，重复的加 -1、-2', () => {
    const out = html('# 常见问题\n\n## 用法\n\n## 用法\n\n## 用法')
    expect(out).toContain('id="常见问题"')
    expect(out).toContain('id="用法"')
    expect(out).toContain('id="用法-1"')
    expect(out).toContain('id="用法-2"')
  })
  it('块级元素带源码起始行', () => {
    const out = html('# 标题\n\n段落\n\n- a\n- b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n```ts\nlet a\n```\n\n> 引用')
    expect(out).toMatch(/<h1[^>]*data-line="1"/)
    expect(out).toMatch(/<p[^>]*data-line="3"/)
    expect(out).toMatch(/<ul[^>]*data-line="5"/)
    expect(out).toMatch(/<li[^>]*data-line="6"/)
    expect(out).toMatch(/<div data-line="8"[^>]*><table/)
    expect(out).toMatch(/<div data-line="12"/)
    expect(out).toMatch(/<blockquote data-line="16"/)
  })
  it('单个换行不换行；对话里照旧换行且没有 data-line / id', () => {
    expect(html('a\nb')).not.toContain('<br')
    const chat = html('# 标题\n\na\nb', false)
    expect(chat).toContain('<br')
    expect(chat).not.toContain('data-line')
    expect(chat).not.toContain('id=')
  })
})
