import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { INITIAL, type IOnigLib } from 'vscode-textmate'
import { OnigScanner, OnigString, loadWASM } from 'vscode-oniguruma'
import type { ExtPackState } from '@pixelsky/protocol'
import { fakePack, fakeState } from '@/features/extpacks/testing'
import { setOnigLibForTests } from './onig'

const h = vi.hoisted(() => ({ state: null as unknown, reads: [] as string[], files: {} as Record<string, unknown> }))
vi.mock('@/features/extpacks/store', () => ({
  getPackState: () => h.state,
  readPackJson: async (key: string, path: string) => {
    h.reads.push(`${key}/${path}`)
    return h.files[`${key}/${path}`]
  },
}))

import { packGrammarForPath } from '../languageIds'
import { grammarFor } from './registry'

const contrib = {
  language: 'demo',
  scopeName: 'source.demo',
  extensions: ['.demo'],
  path: 'demo.tmLanguage.json',
  samples: [],
}
const rule = (name: string): unknown => ({ scopeName: 'source.demo', patterns: [{ match: 'hello', name }] })

beforeAll(async () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'))
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
  const lib: IOnigLib = { createOnigScanner: p => new OnigScanner(p), createOnigString: s => new OnigString(s) }
  setOnigLibForTests(lib)
})

function twoPacks(): ExtPackState {
  return fakeState(
    fakePack({ key: 'f-old', addedAt: 1, contributes: { grammars: [contrib] } }),
    fakePack({ key: 'f-new', addedAt: 2, contributes: { grammars: [contrib] } }),
  )
}

describe('textmate registry 同 scopeName', () => {
  it('加载的语法来自匹配器选中的后装扩展', async () => {
    h.state = twoPacks()
    h.reads = []
    h.files = {
      'f-old/demo.tmLanguage.json': rule('comment.line.old'),
      'f-new/demo.tmLanguage.json': rule('keyword.other.new'),
    }
    const selected = packGrammarForPath('example.demo', undefined, h.state as ExtPackState)
    expect(selected?.pack.key).toBe('f-new')
    const grammar = await grammarFor(selected!)
    expect(h.reads).toEqual(['f-new/demo.tmLanguage.json'])
    expect(grammar!.tokenizeLine('hello', INITIAL).tokens[0].scopes).toEqual(['source.demo', 'keyword.other.new'])
  })
  it('同扩展内下标大的赢', async () => {
    h.state = fakeState(
      fakePack({ key: 'f-one', addedAt: 1, contributes: { grammars: [contrib, { ...contrib, path: 'b.json' }] } }),
    )
    h.reads = []
    h.files = { 'f-one/demo.tmLanguage.json': rule('x.a'), 'f-one/b.json': rule('x.b') }
    const selected = packGrammarForPath('example.demo', undefined, h.state as ExtPackState)
    expect(selected?.index).toBe(1)
    await grammarFor(selected!)
    expect(h.reads).toEqual(['f-one/b.json'])
  })
  it('选中的是 scopeName 相同但优先级较低的扩展时，读它自己的文件', async () => {
    h.state = fakeState(
      fakePack({ key: 'f-old', addedAt: 1, contributes: { grammars: [{ ...contrib, path: 'old.json' }] } }),
      fakePack({
        key: 'f-new',
        addedAt: 2,
        contributes: { grammars: [{ ...contrib, extensions: ['.other'], path: 'new.json' }] },
      }),
    )
    h.reads = []
    h.files = { 'f-old/old.json': rule('comment.line.old'), 'f-new/new.json': rule('keyword.other.new') }
    const selected = packGrammarForPath('example.demo', undefined, h.state as ExtPackState)
    expect(selected?.pack.key).toBe('f-old')
    const grammar = await grammarFor(selected!)
    expect(h.reads).toEqual(['f-old/old.json'])
    expect(grammar!.tokenizeLine('hello', INITIAL).tokens[0].scopes).toEqual(['source.demo', 'comment.line.old'])
  })
})
