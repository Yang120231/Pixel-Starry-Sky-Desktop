// 新会话标题去掉 Markdown 记号（docs/ui/conversation-ux-2.md §2.2）
import { describe, expect, it } from 'vitest'
import { NEW_TITLE, titleFrom } from '../src/host/title'

describe('新会话标题', () => {
  it('去掉行首记号、行内代码、加粗、链接和图片', () => {
    expect(titleFrom('帮我看看 `src/app.ts` 里登录逻辑有什么问题')).toBe('帮我看看 src/app.ts 里登录逻辑有什么问题')
    expect(titleFrom('## **修复** `login()` 的 [空用户名](src/app.ts) 问题')).toBe('修复 login() 的 空用户名 问题')
    expect(titleFrom('> [!WARNING]\n> 先别动线上配置')).toBe('先别动线上配置')
    expect(titleFrom('- [ ] 补测试')).toBe('补测试')
    expect(titleFrom('1. 读取配置\n2. 校验')).toBe('读取配置')
    expect(titleFrom('看这张图 ![截图](a.png)')).toBe('看这张图 截图')
    expect(titleFrom('__重要__：发布前检查')).toBe('重要：发布前检查')
  })

  it('第一行是代码块开头时取代码块里的第一行', () => {
    expect(titleFrom('```ts\nconst a = 1\n```\n为什么报错')).toBe('const a = 1')
  })

  it('不是记号的星号、井号保留；截到 30 个字；空的用默认标题', () => {
    expect(titleFrom('算一下 2*3*4')).toBe('算一下 2*3*4')
    expect(titleFrom('#123 这个 issue 怎么修')).toBe('#123 这个 issue 怎么修')
    expect(titleFrom('/review')).toBe('/review')
    expect(titleFrom('一'.repeat(40))).toBe('一'.repeat(30) + '…')
    expect(titleFrom('   ')).toBe(NEW_TITLE)
  })
})
