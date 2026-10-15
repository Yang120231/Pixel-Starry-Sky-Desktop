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
    // 被量化的分支组（分支重叠）同样会指数回溯，直接当不匹配
    const t0 = Date.now()
    expect(grammarMatchScore(g({ firstLine: '^(a|aa)+$' }), 'unmatched.unknown', 'a'.repeat(80) + '!')).toBe(0)
    expect(Date.now() - t0).toBeLessThan(500)
    expect(Date.now() - t).toBeLessThan(5000)
    expect(grammarMatchScore(g({ firstLine: 'zzz' }), 'x', 'a'.repeat(300) + 'zzz')).toBe(0)
  })
})

describe('grammarMatchScore firstLine 相邻可重叠的量词', () => {
  it('a*a*…a*b 是多项式级回溯，直接当不匹配，不会卡住', () => {
    const t = Date.now()
    expect(grammarMatchScore(g({ firstLine: '^a*a*a*a*a*a*a*a*a*a*b$' }), 'x', 'a'.repeat(80) + '!')).toBe(0)
    expect(Date.now() - t).toBeLessThan(50)
    // 缓存命中后同样是不匹配
    expect(grammarMatchScore(g({ firstLine: '^a*a*a*a*a*a*a*a*a*a*b$' }), 'x', 'a'.repeat(80) + 'b')).toBe(0)
  })
  it('shebang 之类的常见写法照常匹配', () => {
    expect(grammarMatchScore(g({ firstLine: '^#!.*\\bnode\\b' }), 'run', '#!/usr/bin/env node')).toBe(100)
    expect(grammarMatchScore(g({ firstLine: '^#!.*\\b(node|deno)\\b' }), 'run', '#!/usr/bin/env deno')).toBe(100)
    expect(grammarMatchScore(g({ firstLine: '^#!.*\\bpython[\\d\\.]*\\b' }), 'run', '#!/usr/bin/python3.11')).toBe(100)
    expect(grammarMatchScore(g({ firstLine: '^<\\?php' }), 'run', '<?php echo 1;')).toBe(100)
    expect(grammarMatchScore(g({ firstLine: '^#!.*\\bnode\\b' }), 'run', '#!/bin/sh')).toBe(0)
  })
  it('坏的正则当不匹配', () => {
    expect(grammarMatchScore(g({ firstLine: '(' }), 'x', '(')).toBe(0)
  })
  // 放行的写法在最坏输入（200 个可重叠字符 + '!'）下也要很快，防止分析过于宽松
  it.each([
    ['a*a*b', 'a'],
    ['^#!.*\\bnode\\b', 'a'],
    ['^#!.*\\b(node|deno)\\b', 'a'],
    ['^#!.*\\bpython[\\d\\.]*\\b', 'a'],
    ['^\\s*<\\?xml', ' '],
    ['^.*-\\*-\\s*mode:\\s*ruby\\s*-\\*-', ' '],
    ['-\\*-\\s*(mode:)?\\s*(c\\+\\+)\\s*(;|-\\*-)', ' '],
    ['a+b+', 'a'],
    ['^<\\?php', '<'],
  ])('放行的 %s 最坏输入很快', (firstLine, fill) => {
    const t = Date.now()
    grammarMatchScore(g({ firstLine }), 'x', fill.repeat(200) + '!')
    grammarMatchScore(g({ firstLine }), 'x', '#!' + fill.repeat(198) + '!')
    grammarMatchScore(g({ firstLine }), 'x', '-*-' + fill.repeat(197) + '!')
    expect(Date.now() - t).toBeLessThan(200)
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
