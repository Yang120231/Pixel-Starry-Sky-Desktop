import { describe, expect, it } from 'vitest'
import type { ExtGrammar, ExtPackInfo } from '@pixelsky/protocol'
import { fakePack, fakeState } from '../../extpacks/testing'
import {
  firstLineOf,
  grammarBuiltinConflicts,
  grammarOverrideKey,
  languageIdForPath,
  languageKeyForPath,
  packGrammarForPath,
} from './languageIds'

const grammar = (over: Partial<ExtGrammar>): ExtGrammar => ({
  language: 'dotenv',
  scopeName: 'source.dotenv',
  path: 'g.json',
  samples: [],
  ...over,
})
const pack = (key: string, addedAt: number, grammars: ExtGrammar[], extra: Partial<ExtPackInfo> = {}) =>
  fakePack({ key, addedAt, contributes: { grammars }, ...extra })

describe('packGrammarForPath', () => {
  const env = pack('f-a', 1, [grammar({ filenames: ['.env'], extensions: ['.env', '.svg'] })])
  it('没有内置语言时扩展语法生效', () => {
    expect(packGrammarForPath('/p/.env', undefined, fakeState(env))?.key).toBe('f-a@1#0')
  })
  it('内置优先；打开覆盖开关才换', () => {
    expect(packGrammarForPath('/p/a.svg', undefined, fakeState(env))).toBeNull()
    const over = { ...env, options: { overrideBuiltin: ['dotenv'] } }
    expect(packGrammarForPath('/p/a.svg', undefined, fakeState(over))?.pack.key).toBe('f-a')
  })
  it('后装的赢，同时间下标大的赢', () => {
    const early = pack('f-1', 1, [grammar({ extensions: ['.zzz'] })])
    const late = pack('f-2', 2, [grammar({ extensions: ['.zzz'] })])
    expect(packGrammarForPath('a.zzz', undefined, fakeState(early, late))?.pack.key).toBe('f-2')
    const two = pack('f-3', 1, [grammar({ extensions: ['.zzz'] }), grammar({ extensions: ['.zzz'] })])
    expect(packGrammarForPath('a.zzz', undefined, fakeState(two))?.index).toBe(1)
  })
  it('没有 language 的语法（只作 include）不参与', () => {
    const p = pack('f-x', 1, [grammar({ language: undefined, extensions: ['.zzz'] })])
    expect(packGrammarForPath('a.zzz', undefined, fakeState(p))).toBeNull()
  })
})

describe('languageKeyForPath / languageIdForPath', () => {
  it('没有扩展时是内置或 plain，且稳定', () => {
    expect(languageKeyForPath('a.ts')).toBe('builtin:TypeScript')
    expect(languageKeyForPath('a.ts')).toBe(languageKeyForPath('b/a.ts'))
    expect(languageKeyForPath('a.unknown')).toBe('plain')
    expect(languageIdForPath('a.tsx')).toBe('typescriptreact')
    expect(languageIdForPath('a.unknown')).toBeNull()
  })
})

describe('grammarBuiltinConflicts', () => {
  it('扩展名、文件名、通配都对内置语言查一遍并去重', () => {
    expect(grammarBuiltinConflicts(grammar({ extensions: ['.svg'] }))).toEqual(['XML'])
    expect(grammarBuiltinConflicts(grammar({ filenames: ['Dockerfile.dev'] }))).toEqual(['Dockerfile'])
    expect(grammarBuiltinConflicts(grammar({ extensions: ['.xml', '.svg'], filenamePatterns: ['*.json'] }))).toEqual([
      'XML',
      'JSON',
    ])
    expect(grammarBuiltinConflicts(grammar({ extensions: ['.env'] }))).toEqual([])
  })
  it('覆盖键', () => {
    expect(grammarOverrideKey(grammar({}))).toBe('dotenv')
    expect(grammarOverrideKey(grammar({ language: undefined }))).toBe('source.dotenv')
  })
})

describe('firstLineOf', () => {
  it('字符串和 Text', () => {
    expect(firstLineOf('#!/bin/sh\necho')).toBe('#!/bin/sh')
    expect(firstLineOf('a\r\nb')).toBe('a')
    expect(firstLineOf({ lines: 2, line: n => ({ text: n === 1 ? 'x' : 'y' }) })).toBe('x')
  })
})
