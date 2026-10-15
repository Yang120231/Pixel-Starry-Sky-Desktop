import { describe, expect, it } from 'vitest'
import { locateJsonPointer } from './locate'

const at = (text: string, pointer: string) => locateJsonPointer(text, pointer)

describe('locateJsonPointer', () => {
  const doc = '{\n  "a": {\n    "b": [10, {"c": true}]\n  },\n  "d": "x"\n}'
  it('根', () => {
    expect(at(doc, '')).toEqual({ line: 1, column: 1 })
  })
  it('嵌套对象和数组：返回值的起点', () => {
    expect(at(doc, '/a')).toEqual({ line: 2, column: 8 })
    expect(at(doc, '/a/b')).toEqual({ line: 3, column: 10 })
    expect(at(doc, '/a/b/0')).toEqual({ line: 3, column: 11 })
    expect(at(doc, '/a/b/1/c')).toEqual({ line: 3, column: 21 })
    expect(at(doc, '/d')).toEqual({ line: 5, column: 8 })
  })
  it('~0 和 ~1', () => {
    const t = '{"a/b": 1,\n "m~n": 2}'
    expect(at(t, '/a~1b')).toEqual({ line: 1, column: 9 })
    expect(at(t, '/m~0n')).toEqual({ line: 2, column: 9 })
  })
  it('注释和结尾逗号', () => {
    const t = '{\n  // 注释 "x"\n  /* "y": 1,\n */ "x": [1, 2,],\n  "y": 3,\n}'
    expect(at(t, '/x/1')).toEqual({ line: 4, column: 14 })
    expect(at(t, '/y')).toEqual({ line: 5, column: 8 })
  })
  it('CRLF 算一个换行', () => {
    expect(at('{\r\n  "a": 1\r\n}', '/a')).toEqual({ line: 2, column: 8 })
  })
  it('列按 UTF-16 码元：中文一个、emoji 两个', () => {
    expect(at('{"中文": 1}', '/中文')).toEqual({ line: 1, column: 8 })
    expect(at('{"😀": 1, "b": 2}', '/b')).toEqual({ line: 1, column: 16 })
  })
  it('带 BOM 时第一行的列不算 BOM', () => {
    expect(at('﻿{"a": 1}', '/a')).toEqual({ line: 1, column: 7 })
  })
  it('指针找不到：退到找到的最深的上一层', () => {
    expect(at(doc, '/a/zzz')).toEqual({ line: 2, column: 8 })
    expect(at(doc, '/a/b/9')).toEqual({ line: 3, column: 10 })
    expect(at(doc, '/d/x/y')).toEqual({ line: 5, column: 8 })
    expect(at(doc, '/nope')).toEqual({ line: 1, column: 1 })
  })
  it('读不懂的文本和不合法的指针返回 null', () => {
    expect(at('', '/a')).toBeNull()
    expect(at('{"a": ', '/a')).toBeNull()
    expect(at('{"a" 1}', '/a')).toBeNull()
    expect(at('{"a": 1}', 'a')).toBeNull()
  })
})
