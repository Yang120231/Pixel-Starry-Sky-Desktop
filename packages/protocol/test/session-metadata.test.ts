import { describe, expect, it } from 'vitest'
import {
  bottomOrder,
  projectName,
  PROJECT_NAME_LIMIT,
  sessionTitle,
  SESSION_TITLE_LIMIT,
} from '../src/session-metadata'

describe('sessionTitle', () => {
  it('去掉首尾空白后返回', () => {
    expect(sessionTitle('  修复登录  ')).toBe('修复登录')
  })
  it('非字符串、空串、纯空白报错', () => {
    for (const v of [undefined, null, 1, {}, '', '   ']) expect(() => sessionTitle(v)).toThrow('会话名称不能为空')
  })
  it('含换行或控制字符报错', () => {
    expect(() => sessionTitle('a\nb')).toThrow('控制字符')
    expect(() => sessionTitle('a\tb')).toThrow('控制字符')
    expect(() => sessionTitle('a\u007fb')).toThrow('控制字符')
    // 先检查控制字符再 trim：结尾的换行也会报错
    expect(() => sessionTitle('ab\n')).toThrow('控制字符')
  })
  it('长度上限按码点计：200 通过，201 报错', () => {
    expect(sessionTitle('a'.repeat(SESSION_TITLE_LIMIT))).toHaveLength(SESSION_TITLE_LIMIT)
    expect(() => sessionTitle('a'.repeat(SESSION_TITLE_LIMIT + 1))).toThrow('200')
    // 代理对算一个字符
    expect(Array.from(sessionTitle('😀'.repeat(SESSION_TITLE_LIMIT)))).toHaveLength(SESSION_TITLE_LIMIT)
    expect(() => sessionTitle('😀'.repeat(SESSION_TITLE_LIMIT + 1))).toThrow('200')
  })
})

describe('projectName', () => {
  it('去空白、校验空值与控制字符', () => {
    expect(projectName(' 像素星空 ')).toBe('像素星空')
    expect(() => projectName('')).toThrow('项目名称不能为空')
    expect(() => projectName(3)).toThrow('项目名称不能为空')
    expect(() => projectName('a\r\nb')).toThrow('控制字符')
  })
  it('长度上限 100', () => {
    expect(projectName('x'.repeat(PROJECT_NAME_LIMIT))).toHaveLength(PROJECT_NAME_LIMIT)
    expect(() => projectName('x'.repeat(PROJECT_NAME_LIMIT + 1))).toThrow('100')
  })
})

describe('bottomOrder', () => {
  const sort = (xs: Array<{ id: string; bottomedAt?: number | null }>) => [...xs].sort(bottomOrder).map(x => x.id)
  it('普通项保持输入顺序（稳定排序），置底项排在后面', () => {
    expect(
      sort([{ id: 'a', bottomedAt: 5 }, { id: 'b' }, { id: 'c', bottomedAt: null }, { id: 'd', bottomedAt: 0 }]),
    ).toEqual(['b', 'c', 'd', 'a'])
  })
  it('置底项按设置先后排列', () => {
    expect(sort([{ id: 'late', bottomedAt: 20 }, { id: 'early', bottomedAt: 10 }, { id: 'n' }])).toEqual([
      'n',
      'early',
      'late',
    ])
  })
  it('比较值', () => {
    expect(bottomOrder({}, {})).toBe(0)
    expect(bottomOrder({ bottomedAt: 1 }, {})).toBe(1)
    expect(bottomOrder({}, { bottomedAt: 1 })).toBe(-1)
    expect(bottomOrder({ bottomedAt: 3 }, { bottomedAt: 1 })).toBe(2)
  })
})
