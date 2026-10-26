import { describe, expect, it } from 'vitest'
import { citationName, replaceCodexDirectives } from './codexDirectives'
import { replyPreview } from './replyPreview'

const cite = (text: string): string => replaceCodexDirectives(text, c => `<${c.path}|${c.attributes.purpose ?? ''}>`)

describe('Codex 行内标记', () => {
  it('文件引用：Windows 路径按字面读，1～3 个冒号都认，后面的文字留着', () => {
    const path = 'D:\\学习资料\\论文\\修改稿\\03_数值算例_修改稿06_润色.docx'
    expect(cite(`见 :codex-file-citation{path="${path}" purpose="output"} 。`)).toBe(`见 <${path}|output> 。`)
    expect(cite("::codex-file-citation{ path = 'a/b c.md' }")).toBe('<a/b c.md|>')
    expect(cite(':::codex-file-citation{path=src/a.ts purpose=source}x')).toBe('<src/a.ts|source>x')
  })

  it('不认：4 个冒号、前面有 \\ 转义、没有 path、值跨行、属性重复、没闭合、代码里的', () => {
    for (const text of [
      '::::codex-file-citation{path="a.ts"}',
      '\\:codex-file-citation{path="a.ts"}',
      ':codex-file-citation{purpose="output"}',
      ':codex-file-citation{path="a\n.ts"}',
      ':codex-file-citation{path="a.ts" path="b.ts"}',
      ':codex-file-citation{path="a.ts"',
      '`:codex-file-citation{path="a.ts"}`',
      '```\n:codex-file-citation{path="a.ts"}\n```',
    ])
      expect(cite(text)).toBe(text)
  })

  it('行中间没配对的 ``` ~~~ 不算代码块，后面的引用照样换；行首的围栏里不换', () => {
    expect(cite('代码块用 ``` 包起来，别写 ~~~。\n\n已生成 :codex-file-citation{path="/a/b.docx"}')).toBe(
      '代码块用 ``` 包起来，别写 ~~~。\n\n已生成 </a/b.docx|>',
    )
    const fenced = '说明：\n  ```md\n:codex-file-citation{path="a.ts"}\n  ```\n后 :codex-file-citation{path="b"}'
    expect(cite(fenced)).toBe(fenced.replace(':codex-file-citation{path="b"}', '<b|>'))
  })

  it('下一步建议只留文字；两个冒号的、空文字的不认', () => {
    expect(cite('试试 :codex-followup[跑一下 **测试**]{prompt="run \\"tests\\""} 吧')).toBe('试试 跑一下 **测试** 吧')
    expect(cite('::codex-followup[x]{}')).toBe('::codex-followup[x]{}')
    expect(cite(':codex-followup[ ]{}')).toBe(':codex-followup[ ]{}')
  })

  it('一段里有多个；没有标记时返回原字符串', () => {
    expect(cite(':codex-file-citation{path="a"} 和 :codex-file-citation{path="b"}')).toBe('<a|> 和 <b|>')
    const plain = '普通回复 codex'
    expect(cite(plain)).toBe(plain)
  })

  it('文件名、会话列表预览', () => {
    expect(citationName('D:\\x\\y.docx')).toBe('y.docx')
    expect(citationName('/a/b/')).toBe('b')
    expect(replyPreview('已完成。\n\n:codex-file-citation{path="/tmp/out.xlsx" purpose="output"}')).toBe(
      '已完成。 out.xlsx',
    )
  })
})
