import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_REMOVED_EVENT } from '@/features/engine/sessionLifecycle'

type Store = typeof import('./traceHistoryStore')

// 测试环境是 node：自己放一个 localStorage 和能收事件的 window，再重新加载模块（模块加载时挂监听）
let data: Map<string, string>
async function load(): Promise<Store> {
  vi.resetModules()
  return import('./traceHistoryStore')
}

beforeEach(() => {
  data = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  })
  vi.stubGlobal('window', new EventTarget())
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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('读取', () => {
  it('没有数据时回默认', async () => {
    const s = await load()
    const st = s.readTraceHistoryState('a')
    expect(st.seen.size).toBe(0)
    expect(st.clearedAt).toBeNull()
    expect(st.onlyTurn).toBe(false)
  })

  it('坏数据回默认，不抛错', async () => {
    const s = await load()
    data.set(s.TRACE_SEEN_KEY, '{oops')
    data.set(s.TRACE_CLEARED_KEY, '[1,2]')
    data.set(s.TRACE_ONLY_TURN_KEY, 'maybe')
    expect(s.readTraceHistoryState('a')).toEqual({ seen: new Set(), clearedAt: null, onlyTurn: false })
    data.set(s.TRACE_SEEN_KEY, JSON.stringify({ a: 'x', b: [1, 'k'] }))
    data.set(s.TRACE_CLEARED_KEY, JSON.stringify({ a: 'x', b: 5 }))
    expect(s.readTraceHistoryState('a').seen.size).toBe(0)
    expect(s.readTraceHistoryState('a').clearedAt).toBeNull()
    expect(s.readTraceHistoryState('b').seen).toEqual(new Set(['k']))
    expect(s.readTraceHistoryState('b').clearedAt).toBe(5)
  })

  it('数据没变时返回同一个对象，变了换对象', async () => {
    const s = await load()
    const a = s.readTraceHistoryState('a')
    expect(s.readTraceHistoryState('a')).toBe(a)
    s.markSeen('a', 'x')
    const b = s.readTraceHistoryState('a')
    expect(b).not.toBe(a)
    expect(b.seen.has('x')).toBe(true)
    expect(s.readTraceHistoryState('a')).toBe(b)
  })
})

describe('markSeen', () => {
  it('空 id 忽略，重复不再写', async () => {
    const s = await load()
    s.markSeen('a', '')
    expect(data.has(s.TRACE_SEEN_KEY)).toBe(false)
    s.markSeen('a', 'x')
    const raw = data.get(s.TRACE_SEEN_KEY)
    s.markSeen('a', 'x')
    expect(data.get(s.TRACE_SEEN_KEY)).toBe(raw)
    expect(JSON.parse(raw!)).toEqual({ a: ['x'] })
  })

  it('每个会话最多 200 个，删最早的', async () => {
    const s = await load()
    for (let i = 0; i < 205; i++) s.markSeen('a', `id${i}`)
    const seen = s.readTraceHistoryState('a').seen
    expect(seen.size).toBe(200)
    expect(seen.has('id0')).toBe(false)
    expect(seen.has('id4')).toBe(false)
    expect(seen.has('id5')).toBe(true)
    expect(seen.has('id204')).toBe(true)
  })

  it('最多 300 个会话，删最早的', async () => {
    const s = await load()
    for (let i = 0; i < 305; i++) s.markSeen(`s${i}`, 'x')
    expect(Object.keys(JSON.parse(data.get(s.TRACE_SEEN_KEY)!))).toHaveLength(300)
    expect(s.readTraceHistoryState('s0').seen.size).toBe(0)
    expect(s.readTraceHistoryState('s4').seen.size).toBe(0)
    expect(s.readTraceHistoryState('s5').seen.has('x')).toBe(true)
  })

  it('清空时间点同样最多 300 个会话', async () => {
    const s = await load()
    for (let i = 0; i < 302; i++) s.clearHistory(`s${i}`, i + 1)
    expect(Object.keys(JSON.parse(data.get(s.TRACE_CLEARED_KEY)!))).toHaveLength(300)
    expect(s.readTraceHistoryState('s0').clearedAt).toBeNull()
    expect(s.readTraceHistoryState('s301').clearedAt).toBe(302)
  })
})

describe('清空 / 只看这一轮', () => {
  it('clearHistory 与 restoreHistory', async () => {
    const s = await load()
    s.clearHistory('a', 123)
    expect(s.readTraceHistoryState('a').clearedAt).toBe(123)
    expect(s.readTraceHistoryState('b').clearedAt).toBeNull()
    s.restoreHistory('a')
    expect(s.readTraceHistoryState('a').clearedAt).toBeNull()
  })

  it('setOnlyTurn 是全局的', async () => {
    const s = await load()
    s.setOnlyTurn(true)
    expect(s.readTraceHistoryState('a').onlyTurn).toBe(true)
    expect(s.readTraceHistoryState('b').onlyTurn).toBe(true)
    s.setOnlyTurn(false)
    expect(s.readTraceHistoryState('a').onlyTurn).toBe(false)
  })
})

describe('清理', () => {
  it('forgetSessions 删掉 seen 和 cleared', async () => {
    const s = await load()
    s.markSeen('a', 'x')
    s.markSeen('b', 'y')
    s.clearHistory('a', 1)
    s.clearHistory('b', 2)
    s.forgetSessions(['a'])
    expect(s.readTraceHistoryState('a')).toMatchObject({ seen: new Set(), clearedAt: null })
    expect(s.readTraceHistoryState('b').seen.has('y')).toBe(true)
    expect(s.readTraceHistoryState('b').clearedAt).toBe(2)
  })

  it('SESSION_REMOVED_EVENT 触发清理', async () => {
    const s = await load()
    s.markSeen('a', 'x')
    s.clearHistory('a', 1)
    window.dispatchEvent(new CustomEvent(SESSION_REMOVED_EVENT, { detail: { ids: ['a'] } }))
    expect(s.readTraceHistoryState('a')).toMatchObject({ seen: new Set(), clearedAt: null })
  })
})
