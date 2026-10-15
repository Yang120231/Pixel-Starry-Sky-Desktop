import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { StringStream } from '@codemirror/language'
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type IOnigLib } from 'vscode-textmate'
import { OnigScanner, OnigString, loadWASM } from 'vscode-oniguruma'
import { tmParser, type TmState } from './stream'
import { setOnigLibForTests, onigLib } from './onig'

const FIXTURE = resolve(__dirname, '../../../../../../main/extension-packs/__fixtures__/pixelsky.dotenv')
const sample = readFileSync(resolve(FIXTURE, 'samples/example.env'), 'utf8').split('\n')

let grammar: IGrammar

beforeAll(async () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'))
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer)
  const lib: IOnigLib = {
    createOnigScanner: p => new OnigScanner(p),
    createOnigString: s => new OnigString(s),
  }
  setOnigLibForTests(lib)
  const raw = readFileSync(resolve(FIXTURE, 'syntaxes/dotenv.tmLanguage.json'), 'utf8')
  const registry = new Registry({
    onigLib: onigLib(),
    loadGrammar: async () => parseRawGrammar(raw, 'x.json'),
  })
  grammar = (await registry.loadGrammar('source.dotenv')) as IGrammar
})

/** 按行跑一遍，返回每行的 [文本片段, 记号] 列表 */
function run(g: IGrammar, lines: string[]): Array<Array<[string, string | null]>> {
  const parser = tmParser(g, 'dotenv', {})
  let state = parser.startState!(2)
  return lines.map(line => {
    const out: Array<[string, string | null]> = []
    if (!line) {
      parser.blankLine?.(state, 2)
      return out
    }
    const stream = new StringStream(line, 2, 2)
    while (!stream.eol()) {
      stream.start = stream.pos
      const token = parser.token(stream, state)
      expect(stream.pos).toBeGreaterThan(stream.start)
      expect(stream.pos).toBeLessThanOrEqual(line.length)
      out.push([stream.current(), token])
    }
    state = parser.copyState!(state)
    return out
  })
}

describe('tmStreamLanguage', () => {
  it('注释行 → comment，KEY= → propertyName + operator', () => {
    const rows = run(grammar, sample)
    expect(rows[0].some(([, t]) => t === 'comment')).toBe(true)
    const app = rows[2]
    expect(app[0]).toEqual(['APP_NAME', 'propertyName'])
    expect(app[1]).toEqual(['=', 'operator'])
    expect(app.some(([, t]) => t === 'string')).toBe(true)
  })

  it('每个 token 都不越界、不为空', () => {
    for (const row of run(grammar, sample)) for (const [text] of row) expect(text.length).toBeGreaterThan(0)
  })

  it('超长行不分词也不抛错，栈保持不变', () => {
    const parser = tmParser(grammar, 'dotenv', {})
    const state = parser.startState!(2)
    const before = state.stack
    const stream = new StringStream('A='.padEnd(10_001, 'x'), 2, 2)
    expect(parser.token(stream, state)).toBeNull()
    expect(stream.eol()).toBe(true)
    expect(state.stack).toBe(before)
  })

  it('copyState 的队列互相独立', () => {
    const parser = tmParser(grammar, 'dotenv', {})
    const state: TmState = { stack: INITIAL, queue: [[3, 'string']], pos: 0 }
    const copy = parser.copyState!(state)
    copy.queue[0][0] = 9
    copy.queue.push([10, null])
    expect(state.queue).toEqual([[3, 'string']])
  })

  it('stoppedEarly 时保持上一行的栈，末尾越界的结束位置被夹回行长', () => {
    const marker = { tag: 'new' } as unknown as TmState['stack']
    const fake = {
      tokenizeLine: () => ({
        tokens: [{ startIndex: 0, endIndex: 4, scopes: ['comment.line'] }],
        ruleStack: marker,
        stoppedEarly: true,
      }),
    } as unknown as IGrammar
    const parser = tmParser(fake, 'x', {})
    const state = parser.startState!(2)
    const stream = new StringStream('abc', 2, 2)
    expect(parser.token(stream, state)).toBe('comment')
    expect(stream.pos).toBe(3)
    expect(state.stack).toBe(INITIAL)
  })

  it('languageData 带上注释记号', () => {
    const lang = tmParser(grammar, 'dotenv', { commentTokens: { line: '#' } })
    expect(lang.languageData).toMatchObject({ commentTokens: { line: '#' } })
  })
})
