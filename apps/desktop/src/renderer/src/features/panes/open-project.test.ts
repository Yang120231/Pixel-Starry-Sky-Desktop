// 侧栏项目行的「新建会话」（issue #5）：paneActions.open(null, { project }) 在指定项目下开新会话标签
import { beforeEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({
  state: {
    currentProjectId: 'p1' as string | null,
    projects: [
      { id: 'p1', name: '甲', path: 'D:/a' },
      { id: 'p2', name: '乙', path: 'D:/b' },
    ],
    snapshots: {} as Record<string, unknown>,
    sessions: [] as unknown[],
  },
}))

vi.hoisted(() => {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
  Object.assign(globalThis, {
    localStorage: storage,
    window: { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, localStorage: storage },
  })
})

vi.mock('@/features/engine/store', () => ({
  getEngineState: () => engine.state,
  setCurrentProject: (id: string) => {
    engine.state.currentProjectId = id
  },
}))
vi.mock('@/features/machines/store', () => ({ getMachines: () => ({ currentId: 'local' }) }))
vi.mock('@/features/layout/page', () => ({ showWorkbench: () => {} }))

const { paneActions, getPaneState } = await import('./store')
const { focusedTab, isNewTab } = await import('./tree')
const { draftWorkspace } = await import('@/features/machines/drafts')
const { appendComposerDraft } = await import('@/features/engine/drafts')

const focused = (): string => focusedTab(getPaneState().layout)!

describe('在指定项目下新建会话', () => {
  beforeEach(() => {
    engine.state.currentProjectId = 'p1'
  })

  it('开一个新会话标签，绑定到这个项目，当前项目也换过去', () => {
    paneActions.open(null, { project: 'p2' })
    const tab = focused()
    expect(isNewTab(tab)).toBe(true)
    expect(draftWorkspace(tab)).toMatchObject({ projectId: 'p2', name: '乙', path: 'D:/b' })
    expect(engine.state.currentProjectId).toBe('p2')
  })

  it('当前就是还没写东西的新会话：不多开，直接换到这个项目', () => {
    paneActions.open(null, { project: 'p1' })
    const tab = focused()
    paneActions.open(null, { project: 'p2' })
    expect(focused()).toBe(tab)
    expect(draftWorkspace(tab)?.projectId).toBe('p2')
    expect(engine.state.currentProjectId).toBe('p2')
  })

  it('当前的新会话已经写了草稿：另开一个，原来的留在原项目', () => {
    paneActions.open(null, { project: 'p1' })
    const tab = focused()
    appendComposerDraft(tab, '写了一半的话')
    paneActions.open(null, { project: 'p2' })
    const next = focused()
    expect(next).not.toBe(tab)
    expect(draftWorkspace(tab)?.projectId).toBe('p1')
    expect(draftWorkspace(next)?.projectId).toBe('p2')
  })

  it('不指定项目时照旧：当前已经是新会话就不再多开，也不换项目', () => {
    paneActions.open(null, { project: 'p2' })
    const tab = focused()
    engine.state.currentProjectId = 'p1'
    paneActions.open(null)
    expect(focused()).toBe(tab)
    expect(draftWorkspace(tab)?.projectId).toBe('p2')
    expect(engine.state.currentProjectId).toBe('p1')
  })
})
