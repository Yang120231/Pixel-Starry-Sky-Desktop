// 改名 / 移动后已打开的标签换成新 id（审查报告 2026-10-14）：原来 id 不变，之后在旧路径新建或打开文件
// 会打开成改名后的那个，保存也写进它
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data', () => ({ isDemo: false, projects: [] }))
vi.mock('@/data/demo', () => ({ demo: () => ({}) }))
vi.mock('@/features/machines/store', () => ({ machineOf: () => 'local', getMachines: () => ({ currentId: 'local' }) }))
vi.mock('@/features/engine/store', () => ({ getEngineState: () => ({ sessions: [] }) }))
const replaced: [string, string][] = []
vi.mock('@/features/panes/store', () => ({
  paneActions: { replace: (a: string, b: string) => replaced.push([a, b]), detachFileTab: () => {} },
}))

// 磁盘：路径 → 内容
const disk = new Map<string, string>()
const storage = new Map<string, string>()
const events = new EventTarget()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
})
vi.stubGlobal('window', {
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
  dispatchEvent: events.dispatchEvent.bind(events),
  pixelsky: {
    platform: 'linux',
    files: {
      target: async () => ({ name: 'p', path: '/w' }),
      read: async (_ref: unknown, path: string) => {
        const content = disk.get(path)
        if (content === undefined) throw new Error('files.notFound')
        return { kind: 'text', path, content, version: path + content, readonly: false }
      },
      headContent: async () => null,
    },
  },
})
vi.stubGlobal(
  'CustomEvent',
  class extends Event {
    detail: unknown
    constructor(type: string, init?: { detail?: unknown }) {
      super(type)
      this.detail = init?.detail
    }
  },
)

const store = await import('./store')
const { fileTab } = await import('@/features/panes/tree')
const recent = await import('@/features/panel/recentFiles')
const ref = { projectId: 'p1' }
const tab = (id: string) => store.getFiles().tabs.find(t => t.id === id)

beforeEach(() => {
  for (const t of store.getFiles().tabs) store.removeFile(t.id)
  disk.clear()
  replaced.length = 0
})

describe('改名 / 移动后的标签', () => {
  it('标签换成新路径的 id；在原名新建的文件打开成另一个标签，内容和保存都是它自己的', async () => {
    disk.set('a.ts', 'old a')
    const first = await store.openFile(ref, 'a.ts')
    expect(first).toBe(fileTab(ref, 'a.ts'))
    store.updateFile(first!, { draft: 'old a, edited' })
    // 改名：a.ts → b.ts
    disk.set('b.ts', disk.get('a.ts')!)
    disk.delete('a.ts')
    const moved: unknown[] = []
    window.addEventListener(store.FILE_RENAMED_EVENT, e => moved.push((e as CustomEvent).detail))
    store.renameOpenFiles(ref, 'a.ts', 'b.ts')
    const renamed = fileTab(ref, 'b.ts')
    expect(tab(renamed)).toMatchObject({ path: 'b.ts', draft: 'old a, edited' })
    expect(tab(first!)).toBeUndefined()
    expect(store.getFiles().active).toBe(renamed)
    expect(moved).toEqual([[{ from: first, to: renamed }]])
    expect(replaced).toEqual([[first, renamed]])
    // 在原名新建 a.ts 再打开
    disk.set('a.ts', 'brand new a')
    const again = await store.openFile(ref, 'a.ts')
    expect(again).toBe(fileTab(ref, 'a.ts'))
    expect(tab(again!)).toMatchObject({ path: 'a.ts', draft: 'brand new a' })
    expect(tab(renamed)).toMatchObject({ path: 'b.ts', draft: 'old a, edited' })
  })
  it('改名、关掉标签后再打开原路径：读的是原路径', async () => {
    disk.set('c.ts', 'c')
    const id = await store.openFile(ref, 'c.ts')
    disk.set('d.ts', 'c')
    disk.delete('c.ts')
    store.renameOpenFiles(ref, 'c.ts', 'd.ts')
    store.removeFile(fileTab(ref, 'd.ts'))
    disk.set('c.ts', 'new c')
    const reopened = await store.openFile(ref, 'c.ts')
    expect(reopened).toBe(id)
    expect(tab(reopened!)).toMatchObject({ path: 'c.ts', draft: 'new c' })
  })
  it('文件夹改名：里面打开的文件都换；最近文件跟着换', async () => {
    disk.set('src/x.ts', 'x')
    const x = await store.openFile(ref, 'src/x.ts')
    recent.recordRecentFile('scope', x!)
    disk.set('lib/x.ts', 'x')
    store.renameOpenFiles(ref, 'src', 'lib')
    expect(tab(fileTab(ref, 'lib/x.ts'))).toMatchObject({ path: 'lib/x.ts' })
    expect(JSON.parse(storage.get('pixelsky.right-workspace.recent.v1') ?? '{}').scope[0].id).toBe(
      fileTab(ref, 'lib/x.ts'),
    )
  })
})
