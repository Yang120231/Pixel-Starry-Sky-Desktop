import * as onigNs from 'vscode-oniguruma'
import * as tmNs from 'vscode-textmate'
import type { IGrammar, IOnigLib, IRawGrammar, StateStack } from 'vscode-textmate'
import { onigWasmBytes } from './onig-wasm'

// 这两个包是 CJS：原生 Node 下具名导出认不出来，只能取 default；打包后两种形态都有
function cjs<T>(ns: unknown): T {
  const d = (ns as { default?: unknown }).default
  return (d ?? ns) as T
}
const onig = cjs<typeof onigNs>(onigNs)
const tm = cjs<typeof tmNs>(tmNs)

export interface TmTokenizer {
  initial: unknown
  line(text: string, state: unknown, timeLimitMs: number): { state: unknown; stoppedEarly: boolean }
}

export interface TmEngine {
  compileError(source: string): string | null
  /** 根语法加载不了返回 null；抛错由调用方报 grammar.load */
  tokenizer(
    root: string,
    grammars: Array<{ scopeName: string; text: string; injectTo?: string[] }>,
  ): Promise<TmTokenizer | null>
}

// 一个线程只装一次 wasm
let wasmReady: Promise<void> | null = null

function loadWasmOnce(wasm?: Uint8Array): Promise<void> {
  return (wasmReady ??= (async () => {
    const bytes = wasm ?? (await onigWasmBytes())
    // 拷成独立的 ArrayBuffer，避免带着 Buffer 池里多余的偏移
    await onig.loadWASM(bytes.slice().buffer as ArrayBuffer)
  })().catch(e => {
    wasmReady = null
    throw e
  }))
}

export async function createTmEngine(wasm?: Uint8Array): Promise<TmEngine> {
  await loadWasmOnce(wasm)
  const onigLib: Promise<IOnigLib> = Promise.resolve({
    createOnigScanner: patterns => new onig.OnigScanner(patterns),
    createOnigString: s => new onig.OnigString(s),
  })
  return {
    compileError(source) {
      let scanner: InstanceType<typeof onig.OnigScanner> | null = null
      try {
        scanner = new onig.OnigScanner([source])
        return null
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      } finally {
        scanner?.dispose()
      }
    },
    async tokenizer(root, grammars) {
      // vscode-textmate 对没提供的根语法会抛错；这里统一成 null
      if (!grammars.some(g => g.scopeName === root)) return null
      // 和渲染进程 registry.ts 一样：按 scopeName 找语法，injectTo 决定注入
      const registry = new tm.Registry({
        onigLib,
        async loadGrammar(scopeName): Promise<IRawGrammar | null> {
          const hit = grammars.find(g => g.scopeName === scopeName)
          if (!hit) return null
          return tm.parseRawGrammar(JSON.stringify(JSON.parse(hit.text)), 'x.json')
        },
        getInjections(scopeName) {
          return grammars.filter(g => g.injectTo?.includes(scopeName)).map(g => g.scopeName)
        },
      })
      const grammar: IGrammar | null = await registry.loadGrammar(root)
      if (!grammar) return null
      return {
        initial: tm.INITIAL,
        line(text, state, timeLimitMs) {
          const r = grammar.tokenizeLine(text, state as StateStack, timeLimitMs)
          return { state: r.ruleStack, stoppedEarly: r.stoppedEarly }
        },
      }
    },
  }
}
