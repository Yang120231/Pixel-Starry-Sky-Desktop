import { Registry, parseRawGrammar, type IGrammar, type IRawGrammar } from 'vscode-textmate'
import type { ExtPackState } from '@pixelsky/protocol'
import { compareContributionPriority, contributionsFrom, livePacks } from '@/features/extpacks/model'
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

let current: { key: string; registries: Map<string, Registry> } | null = null

/** root：匹配器选中的那条语法；它的 scopeName 被别的扩展同名时，根语法也必须读它自己的文件，其余 scopeName（引用、注入）按优先级取 */
function registryFor(state: ExtPackState, root?: PackGrammarRef): Registry {
  const key = grammarSetKey(state)
  if (current?.key !== key) current = { key, registries: new Map() }
  const rootKey = root ? `${root.pack.key}#${root.index}` : ''
  const cached = current.registries.get(rootKey)
  if (cached) return cached
  const grammars = contributionsFrom(state, 'grammars')
  const registry = new Registry({
    onigLib: onigLib(),
    async loadGrammar(scopeName): Promise<IRawGrammar | null> {
      // 同 scopeName 的取优先级最高的，和 packGrammarForPath 的同分规则一致
      let hit = grammars
        .filter(g => g.item.scopeName === scopeName)
        .reduce<(typeof grammars)[number] | null>((a, g) => (!a || compareContributionPriority(g, a) > 0 ? g : a), null)
      if (root && root.grammar.scopeName === scopeName) {
        hit = grammars.find(g => g.pack.key === root.pack.key && g.index === root.index) ?? hit
      }
      if (!hit) return null
      const json = await readPackJson(hit.pack.key, hit.item.path)
      return parseRawGrammar(JSON.stringify(json), 'x.json')
    },
    getInjections(scopeName) {
      return [...new Set(grammars.filter(g => g.item.injectTo?.includes(scopeName)).map(g => g.item.scopeName))]
    },
  })
  current.registries.set(rootKey, registry)
  return registry
}

export async function grammarFor(ref: PackGrammarRef): Promise<IGrammar | null> {
  return registryFor(getPackState(), ref).loadGrammar(ref.grammar.scopeName)
}
