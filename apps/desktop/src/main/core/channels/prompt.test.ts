// 接力解析前去掉代码（withoutCode）：围栏按 Markdown 的规则认，和界面显示一致
import { describe, expect, it } from 'vitest'
import { withoutCode } from './prompt'

describe('withoutCode', () => {
  it('代码里的字符串含同样的围栏字符：不提前结束，后面的 @ 仍在代码里', () => {
    expect(withoutCode('~~~js\nconst d = "~~~";\n// @乙 仅供展示\n~~~')).not.toContain('@乙')
    expect(withoutCode('```js\nconst d = "```";\n// @乙 仅供展示\n```')).not.toContain('@乙')
  })

  it('结束围栏不能比开头短，可以更长、可以缩进最多 3 格、后面可以有空白', () => {
    expect(withoutCode('````\n```\n@乙\n````\n@甲 看看')).toBe('\n@甲 看看')
    expect(withoutCode('```\n@乙\n   `````  \n@甲')).toBe('\n@甲')
    // 不同字符不算结束
    expect(withoutCode('```\n~~~\n@乙\n```\n@甲')).toBe('\n@甲')
  })

  it('没闭合的围栏一直算到末尾；反引号围栏的信息串里有反引号时不是围栏', () => {
    expect(withoutCode('先看\n\n~~~\n@乙 改一下')).toBe('先看\n\n')
    expect(withoutCode('``` a`b\n@乙')).toContain('@乙')
  })

  it('代码块的位置留一个空行：前后两段仍是两段；行内代码照旧去掉', () => {
    expect(withoutCode('@甲 前面\n```\nx\n```\n@乙 后面')).toBe('@甲 前面\n\n@乙 后面')
    expect(withoutCode('用 `@乙` 这个写法，@甲 看看')).toBe('用  这个写法，@甲 看看')
  })
})
