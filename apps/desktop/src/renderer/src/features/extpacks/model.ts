import type { ExtPackContributes, ExtPackContributionKind, ExtPackInfo, ExtPackState } from '@pixelsky/protocol'

// 扩展包状态的纯函数：排序、取贡献、拼资源地址。不碰 window，node 测试可直接用

export const EMPTY_PACK_STATE: ExtPackState = { revision: 0, loading: true, packs: [] }

/** 生效的扩展：内置在前，其后按添加时间从早到晚 */
export function livePacks(state: ExtPackState): ExtPackInfo[] {
  return state.packs
    .filter(p => p.live)
    .sort((a, b) => (a.source === b.source ? a.addedAt - b.addedAt : a.source === 'builtin' ? -1 : 1))
}

export interface ContributionRef<K extends ExtPackContributionKind> {
  pack: ExtPackInfo
  /** 清单下标 */
  index: number
  item: NonNullable<ExtPackContributes[K]>[number]
}

export function isContributionActive(p: ExtPackInfo, kind: ExtPackContributionKind, index: number): boolean {
  return p.live && !p.inactive[kind]?.includes(index)
}

/** 遍历生效扩展里某一类贡献，跳过被停用的下标；index 是清单下标 */
export function contributionsFrom<K extends ExtPackContributionKind>(
  state: ExtPackState,
  kind: K,
): Array<ContributionRef<K>> {
  const out: Array<ContributionRef<K>> = []
  for (const pack of livePacks(state)) {
    const list = pack.manifest?.contributes[kind] as Array<ContributionRef<K>['item']> | undefined
    if (!Array.isArray(list)) continue
    list.forEach((item, index) => {
      if (isContributionActive(pack, kind, index)) out.push({ pack, index, item })
    })
  }
  return out
}

/** pixelsky-ext://<key>/<各段单独编码>?v=<版本> */
export function assetUrl(key: string, path: string, revision: number): string {
  return `pixelsky-ext://${key}/${path.split('/').map(encodeURIComponent).join('/')}?v=${revision}`
}

/** 'pub.name/item' → { packId, itemId } */
export function packIdRef(ref: string): { packId: string; itemId: string } | null {
  const i = ref.indexOf('/')
  if (i <= 0 || i === ref.length - 1) return null
  return { packId: ref.slice(0, i), itemId: ref.slice(i + 1) }
}
