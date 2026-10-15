import { describe, expect, it } from 'vitest'
import type { ExtGrammar } from './types'
import { extText, globToRegExp, grammarMatchScore, packDir, resolvePackPath, wildcardMatch } from './match'

const g = (over: Partial<ExtGrammar>): ExtGrammar => ({ scopeName: 'source.x', path: 'a.json', samples: [], ...over })

describe('resolvePackPath', () => {
  it('把 ./../ 接到主题目录上', () => {
    expect(resolvePackPath('theme', './../icons/a.svg')).toBe('icons/a.svg')
    expect(resolvePackPath('', 'a/b.json')).toBe('a/b.json')
  })
  it('逃出根目录、反斜杠、冒号、绝对路径都是 null', () => {
    expect(resolvePackPath('theme', '../../x')).toBeNull()
    expect(resolvePackPath('', 'a\\b')).toBeNull()
    expect(resolvePackPath('', 'C:/x')).toBeNull()
    expect(resolvePackPath('', '/etc/x')).toBeNull()
  })
})

describe('packDir', () => {
  it('posix dirname', () => {
    expect(packDir('theme/a.json')).toBe('theme')
    expect(packDir('a.json')).toBe('')
  })
})

describe('grammarMatchScore', () => {
  it('优先级：文件名 > 通配 > 扩展名 > 首行', () => {
    const grammar = g({ filenames: ['.env'], filenamePatterns: ['.env.*'], extensions: ['.env'], firstLine: '^#!' })
    expect(grammarMatchScore(grammar, '.env')).toBe(400)
    expect(grammarMatchScore(grammar, '.env.local')).toBe(300)
    expect(grammarMatchScore(g({ extensions: ['.foo'] }), 'a.foo')).toBe(204)
    expect(grammarMatchScore(g({ firstLine: '^#!' }), 'run', '#!/bin/sh')).toBe(100)
    expect(grammarMatchScore(g({ extensions: ['.foo'] }), 'a.bar')).toBe(0)
  })
})

describe('grammarMatchScore 补充', () => {
  it('filenames 区分大小写', () => {
    expect(grammarMatchScore(g({ filenames: ['Makefile.local'] }), 'makefile.local')).toBe(0)
    expect(grammarMatchScore(g({ filenames: ['Makefile.local'] }), 'Makefile.local')).toBe(400)
  })
  it('firstLine 只测前 200 个字符，嵌套量词的长行不会卡死', () => {
    const t = Date.now()
    expect(grammarMatchScore(g({ firstLine: '^(a+)+$' }), 'x', 'a'.repeat(30) + '!')).toBe(0)
    expect(Date.now() - t).toBeLessThan(5000)
    expect(grammarMatchScore(g({ firstLine: 'zzz' }), 'x', 'a'.repeat(300) + 'zzz')).toBe(0)
  })
})

describe('wildcardMatch', () => {
  it('只认 *，整串匹配，不分大小写', () => {
    expect(wildcardMatch('.env.*', '.ENV.local')).toBe(true)
    expect(wildcardMatch('.env.*', '.env')).toBe(false)
    expect(wildcardMatch('a*b*c', 'aXbYc')).toBe(true)
    expect(wildcardMatch('a*b*c', 'aXbY')).toBe(false)
    expect(wildcardMatch('*', '')).toBe(true)
  })
  it('很多个 * 也是线性的，不会卡', () => {
    const t = Date.now()
    expect(wildcardMatch('*a*a*a*a*a*a*a*a*b', 'a'.repeat(5000))).toBe(false)
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('globToRegExp', () => {
  it('只认 *，整串匹配，不分大小写', () => {
    const re = globToRegExp('.env.*')
    expect(re.test('.env.local')).toBe(true)
    expect(re.test('.ENV.x')).toBe(true)
    expect(re.test('xenv.local')).toBe(false)
    expect(re.test('.env')).toBe(false)
  })
})

describe('extText', () => {
  it('英文缺失时退回中文', () => {
    expect(extText({ zh: '你好' }, 'en-US')).toBe('你好')
    expect(extText({ zh: '你好', en: 'Hi' }, 'en-US')).toBe('Hi')
    expect(extText({ zh: '你好', en: 'Hi' }, 'zh-CN')).toBe('你好')
    expect(extText('x', 'en-US')).toBe('x')
  })
})
