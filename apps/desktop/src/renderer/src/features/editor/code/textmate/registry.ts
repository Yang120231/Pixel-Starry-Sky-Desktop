import { Registry, parseRawGrammar, type IGrammar, type IRawGrammar } from 'vscode-textmate'
import type { ExtPackState } from '@pixelsky/protocol'
import { contributionsFrom, livePacks } from '@/features/extpacks/model'
import { getPackState, readPackJson } from '@/features/extpacks/store'
import type { PackGrammarRef } from '../languageIds'
import { onigLib } from './onig'

// 每个「语法集版本」一个 Registry：生效扩展里所有语法贡献的 key@版本 拼起来，只要有扩展启停 / 重载就换一个新的

export function grammarSetKey(state: ExtPackState): string {
  return livePacks(state)
    .filter(p => (p.manifest?.contributes.grammars?.length ?? 0) > 0)
    .map(p => `${p.key}@${p.revision}:${(p.inactive.grammars ?? []).join(',')}`)
    .join('|')
}

let current: { key: string; registry: Registry } | null = null

function registryFor(state: ExtPackState): Registry {
  const key = grammarSetKey(state)
  if (current?.key === key) return current.registry
  const grammars = contributionsFrom(state, 'grammars')
  const registry = new Registry({
    onigLib: onigLib(),
    async loadGrammar(scopeName): Promise<IRawGrammar | null> {
      const hit = grammars.find(g => g.item.scopeName === scopeName)
      if (!hit) return null
      const json = await readPackJson(hit.pack.key, hit.item.path)
      return parseRawGrammar(JSON.stringify(json), 'x.json')
    },
    getInjections(scopeName) {
      return grammars.filter(g => g.item.injectTo?.includes(scopeName)).map(g => g.item.scopeName)
    },
  })
  current = { key, registry }
  return registry
}

export async function grammarFor(ref: PackGrammarRef): Promise<IGrammar | null> {
  return registryFor(getPackState()).loadGrammar(ref.grammar.scopeName)
}
