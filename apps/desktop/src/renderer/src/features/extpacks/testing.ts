import type { ExtPackContributes, ExtPackInfo, ExtPackState } from '@pixelsky/protocol'

// 测试用的假扩展包（各工作包的测试共用）

export function fakePack(over: Partial<ExtPackInfo> & { contributes?: ExtPackContributes } = {}): ExtPackInfo {
  const { contributes, ...rest } = over
  return {
    key: 'f-1',
    id: 'a.b',
    source: 'folder',
    path: '/x',
    enabled: true,
    addedAt: 1,
    revision: 1,
    status: 'ok',
    manifest: { contributes: contributes ?? {} } as ExtPackInfo['manifest'],
    live: true,
    inactive: {},
    issues: [],
    options: {},
    skills: [],
    ...rest,
  }
}

export function fakeState(...packs: ExtPackInfo[]): ExtPackState {
  return { revision: 1, loading: false, packs }
}
