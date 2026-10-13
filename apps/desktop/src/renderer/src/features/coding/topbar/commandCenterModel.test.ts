import { describe, expect, it } from 'vitest'
import { parseQuery } from './commandCenterModel'

describe('parseQuery', () => {
  it('没有前缀就是文件', () => {
    expect(parseQuery('App.tsx')).toEqual({ kind: 'file', term: 'App.tsx', line: null })
    expect(parseQuery('  foo bar  ')).toEqual({ kind: 'file', term: 'foo bar', line: null })
    expect(parseQuery('')).toEqual({ kind: 'file', term: '', line: null })
  })
  it('> # @ 前缀', () => {
    expect(parseQuery('>git push').kind).toBe('command')
    expect(parseQuery('> git push').term).toBe('git push')
    expect(parseQuery('#登录').kind).toBe('chat')
    expect(parseQuery('@render').kind).toBe('symbol')
    expect(parseQuery('>').term).toBe('')
  })
  it('前面的空格不影响前缀', () => {
    expect(parseQuery('  >x').kind).toBe('command')
  })
  it(':N 跳到某行', () => {
    expect(parseQuery(':42')).toEqual({ kind: 'line', term: '42', line: 42 })
    expect(parseQuery(': 7 ').line).toBe(7)
  })
  it('非法的行号是 null', () => {
    expect(parseQuery(':abc').line).toBeNull()
    expect(parseQuery(':').line).toBeNull()
    expect(parseQuery(':0').line).toBeNull()
    expect(parseQuery(':-3').line).toBeNull()
    expect(parseQuery(':4x').line).toBeNull()
    expect(parseQuery(':abc').kind).toBe('line')
  })
  it('文件名里中间的前缀字符不是前缀', () => {
    expect(parseQuery('a>b').kind).toBe('file')
    expect(parseQuery('a:12').kind).toBe('file')
  })
})
