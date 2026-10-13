import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FeedbackChange, FeedbackList, FeedbackSummary } from '../../shared/types/feedback'
import {
  ACTIVE_POLL_INTERVAL_MS,
  ACTIVE_WINDOW_MS,
  FeedbackTracker,
  FileNotifiedStore,
  POLL_INTERVAL_MS,
  type NotifiedStore,
} from './tracker'

const thread = (id: string, over: Partial<FeedbackSummary> = {}): FeedbackSummary => ({
  id,
  type: 'bug',
  title: id,
  status: 'replied',
  createdAt: 1,
  updatedAt: 100,
  unread: true,
  preview: '',
  previewAuthor: 'team',
  ...over,
})

const page = (threads: FeedbackSummary[]): FeedbackList => ({
  threads,
  unreadCount: threads.filter(t => t.unread).length,
  nextBefore: null,
})

function memoryStore(initial: Record<string, Record<string, number>> = {}): NotifiedStore {
  const data = initial
  return {
    get: email => ({ ...(data[email] ?? {}) }),
    record: (email, entries) => void (data[email] = { ...(data[email] ?? {}), ...entries }),
  }
}

function setup(lists: (() => Promise<FeedbackList>)[], store = memoryStore()) {
  const changes: FeedbackChange[] = []
  const queue = [...lists]
  const list = vi.fn(() => (queue.length > 1 ? queue.shift()! : queue[0])())
  const tracker = new FeedbackTracker({ list, store, emit: c => changes.push(c) })
  return { tracker, changes, list, store }
}

const ok = (threads: FeedbackSummary[]) => () => Promise.resolve(page(threads))

describe('FeedbackTracker', () => {
  it('每条回复只提醒一次，团队再回复才再提醒', async () => {
    const t1 = thread('fb_a')
    const { tracker, changes } = setup([ok([t1]), ok([t1]), ok([{ ...t1, updatedAt: 200 }])])
    await tracker.setAccount('a@x')
    expect(changes.at(-1)?.fresh.map(t => t.id)).toEqual(['fb_a'])
    expect(tracker.state()).toMatchObject({ status: 'ready', email: 'a@x', unreadCount: 1 })
    await tracker.poll()
    expect(changes.at(-1)?.fresh).toEqual([])
    await tracker.poll()
    expect(changes.at(-1)?.fresh.map(t => t.updatedAt)).toEqual([200])
  })

  it('已读的不提醒；记录跨重启保留（下次启动只补一次）', async () => {
    const store = memoryStore()
    const read = thread('fb_r', { unread: false })
    const unread = thread('fb_u')
    const first = setup([ok([read, unread])], store)
    await first.tracker.setAccount('a@x')
    expect(first.changes.at(-1)?.fresh.map(t => t.id)).toEqual(['fb_u'])
    const second = setup([ok([read, unread])], store)
    await second.tracker.setAccount('a@x')
    expect(second.changes.at(-1)?.fresh).toEqual([])
    // 应用关着时来了新回复
    const third = setup([ok([{ ...unread, updatedAt: 300 }])], store)
    await third.tracker.setAccount('a@x')
    expect(third.changes.at(-1)?.fresh).toHaveLength(1)
  })

  it('不同账号分开记录', async () => {
    const store = memoryStore()
    const a = setup([ok([thread('fb_a')])], store)
    await a.tracker.setAccount('a@x')
    const b = setup([ok([thread('fb_a')])], store)
    await b.tracker.setAccount('b@x')
    expect(b.changes.at(-1)?.fresh).toHaveLength(1)
  })

  it('退出登录清空缓存、未读归零并推送', async () => {
    const { tracker, changes, list } = setup([ok([thread('fb_a')])])
    await tracker.setAccount('a@x')
    expect(tracker.state().unreadCount).toBe(1)
    await tracker.setAccount(null)
    expect(tracker.state()).toMatchObject({ status: 'signed-out', email: null, unreadCount: 0, threads: [] })
    expect(changes.at(-1)).toMatchObject({ state: { status: 'signed-out' }, fresh: [] })
    list.mockClear()
    await tracker.poll()
    expect(list).not.toHaveBeenCalled()
  })

  it('退出登录后迟到的检查结果作废', async () => {
    let release!: (l: FeedbackList) => void
    const slow = () => new Promise<FeedbackList>(r => (release = r))
    const { tracker, changes } = setup([slow])
    const p = tracker.setAccount('a@x')
    await tracker.setAccount(null)
    release(page([thread('fb_a')]))
    await p
    expect(tracker.state().status).toBe('signed-out')
    expect(changes.every(c => c.fresh.length === 0)).toBe(true)
  })

  it('同一时间只有一个请求；期间的再次检查合并成一次重跑', async () => {
    let running = 0,
      peak = 0
    const slow = async () => {
      peak = Math.max(peak, ++running)
      await new Promise(r => setTimeout(r, 5))
      running--
      return page([])
    }
    const { tracker, list } = setup([slow])
    const signIn = tracker.setAccount('a@x')
    await Promise.all([tracker.poll(), tracker.poll(), tracker.poll()])
    await signIn
    expect(peak).toBe(1)
    expect(list.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('404 是 not-deployed；其他错误保留上次的列表', async () => {
    const t1 = thread('fb_a')
    const { tracker } = setup([
      ok([t1]),
      () => Promise.reject(Object.assign(new Error('服务暂时不可用'), { code: 'UNAVAILABLE' })),
      () => Promise.reject(Object.assign(new Error('暂未开放'), { code: 'NOT_DEPLOYED' })),
    ])
    await tracker.setAccount('a@x')
    await tracker.poll()
    expect(tracker.state()).toMatchObject({ status: 'error', error: '服务暂时不可用', threads: [t1], unreadCount: 1 })
    await tracker.poll()
    expect(tracker.state()).toMatchObject({ status: 'not-deployed', threads: [], unreadCount: 0 })
  })

  it('平时 10 分钟一次；提交 / 补充后的 30 分钟里 2 分钟一次；换账号回到平时', async () => {
    let now = 1_000_000
    const tracker = new FeedbackTracker({
      list: () => Promise.resolve(page([])),
      store: memoryStore(),
      emit: () => {},
      now: () => now,
    })
    expect(tracker.due()).toBe(true) // 从没检查过
    await tracker.setAccount('a@x')
    expect(tracker.pollInterval()).toBe(POLL_INTERVAL_MS)
    now += ACTIVE_POLL_INTERVAL_MS
    expect(tracker.due()).toBe(false)
    tracker.markActive()
    expect(tracker.pollInterval()).toBe(ACTIVE_POLL_INTERVAL_MS)
    expect(tracker.due()).toBe(true)
    await tracker.poll()
    now += ACTIVE_POLL_INTERVAL_MS - 1
    expect(tracker.due()).toBe(false)
    now += ACTIVE_WINDOW_MS
    expect(tracker.pollInterval()).toBe(POLL_INTERVAL_MS)
    tracker.markActive()
    await tracker.setAccount('b@x')
    expect(tracker.pollInterval()).toBe(POLL_INTERVAL_MS)
  })

  it('系统时间往回调：马上可以再查，不会停到时间追上来', async () => {
    let now = 10_000_000
    const tracker = new FeedbackTracker({
      list: () => Promise.resolve(page([])),
      store: memoryStore(),
      emit: () => {},
      now: () => now,
    })
    await tracker.setAccount('a@x')
    tracker.markActive()
    expect(tracker.due()).toBe(false)
    now -= 3_600_000
    expect(tracker.sinceLastPoll()).toBe(Infinity)
    expect(tracker.due()).toBe(true)
    expect(tracker.pollInterval()).toBe(POLL_INTERVAL_MS)
  })

  it('检查失败报一次（同一原因连续失败不重复，成功后再失败再报）；登录过期不报', async () => {
    const fail = (code: string, message: string) => () => Promise.reject(Object.assign(new Error(message), { code }))
    const errors: unknown[] = []
    const queue = [
      ok([]),
      fail('UNAVAILABLE', '服务暂时不可用'),
      fail('UNAVAILABLE', '服务暂时不可用'),
      fail('NETWORK', '连不上'),
      ok([]),
      fail('NETWORK', '连不上'),
      fail('AUTH_EXPIRED', '登录过期'),
    ]
    const tracker = new FeedbackTracker({
      list: () => queue.shift()!(),
      store: memoryStore(),
      emit: () => {},
      onError: e => errors.push(e),
    })
    await tracker.setAccount('a@x')
    for (let i = 0; i < 6; i++) await tracker.poll()
    expect(errors).toEqual([
      { code: 'UNAVAILABLE', message: '服务暂时不可用' },
      { code: 'NETWORK', message: '连不上' },
      { code: 'NETWORK', message: '连不上' },
    ])
  })
})

describe('FileNotifiedStore', () => {
  it('原子写入并能重新读出；缺文件当作空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-'))
    try {
      const file = join(dir, 'feedback.json')
      const store = new FileNotifiedStore(file)
      store.record('a@x', { fb_a: 5 })
      store.record('a@x', { fb_b: 6 })
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
        version: 1,
        accounts: { 'a@x': { notified: { fb_a: 5, fb_b: 6 } } },
      })
      expect(new FileNotifiedStore(file).get('a@x')).toEqual({ fb_a: 5, fb_b: 6 })
      expect(new FileNotifiedStore(join(dir, 'missing.json')).get('a@x')).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
