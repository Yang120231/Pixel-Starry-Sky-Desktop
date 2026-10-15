import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 云端服务的契约样例（services/cloud/testdata/contract/desktop/feedback-*.json，形如 {endpoint, status, body}）：
// Go 那边检查实际响应和样例一致，这里用同一份样例喂桌面端的解析代码。样例不存在（云端代码没拉下来、
// 还没生成）时整组 / 单个用例跳过。

const dir = fileURLToPath(new URL('../../../../../services/cloud/testdata/contract/desktop/', import.meta.url))

interface Sample {
  endpoint: string
  status: number
  body: unknown
}
const has = (name: string): boolean => existsSync(dir + name)
const sample = (name: string): Sample => JSON.parse(readFileSync(dir + name, 'utf8')) as Sample
const files = existsSync(dir) ? readdirSync(dir).filter(n => /^feedback-.*\.json$/.test(n)) : []

const mocks = vi.hoisted(() => ({ next: null as { status: number; body: unknown } | null }))
vi.mock('../account/account', () => ({
  feedbackFetch: async () => {
    if (!mocks.next) throw new Error('没有准备样例')
    return new Response(JSON.stringify(mocks.next.body), {
      status: mocks.next.status,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}))

const api = await import('./api')
const ID = 'fb_abcdEFGH12345678'

function serve(s: Sample): void {
  mocks.next = { status: s.status, body: s.body }
}

function expectFields(value: Record<string, unknown>, fields: Record<string, string | string[]>): void {
  for (const [key, type] of Object.entries(fields)) {
    const actual = value[key] === null ? 'null' : typeof value[key]
    expect([type].flat(), `${key} 的类型`).toContain(actual)
  }
}

beforeEach(() => {
  mocks.next = null
})

const SUMMARY = {
  id: 'string',
  type: 'string',
  title: 'string',
  status: 'string',
  createdAt: 'number',
  updatedAt: 'number',
  unread: 'boolean',
  preview: 'string',
  previewAuthor: 'string',
  teamSeen: 'boolean',
  teamSeenAt: ['number', 'null'],
  working: 'boolean',
  workingAt: ['number', 'null'],
  messageCount: 'number',
  attachments: 'object',
}

function expectDetail(d: Awaited<ReturnType<typeof api.getFeedback>>): void {
  expectFields(d.thread as unknown as Record<string, unknown>, {
    ...SUMMARY,
    closedBy: ['string', 'null'],
    closedAt: ['number', 'null'],
  })
  expect(d.thread.createdAt).toBeGreaterThan(0)
  expect(d.messages.length).toBeGreaterThan(0)
  for (const m of d.messages) {
    expectFields(m as unknown as Record<string, unknown>, {
      id: 'number',
      author: 'string',
      kind: 'string',
      body: 'string',
      createdAt: 'number',
      diagnostics: ['object', 'null'],
      error: ['object', 'null'],
      attachments: 'object',
    })
    expect(['user', 'team']).toContain(m.author)
    expect(['message', 'closed', 'reopened']).toContain(m.kind)
    expect(m.createdAt).toBeGreaterThan(0)
    for (const a of m.attachments)
      expectFields(a as unknown as Record<string, unknown>, {
        id: 'number',
        kind: 'string',
        name: 'string',
        mediaType: 'string',
        size: 'number',
        rawSize: 'number',
        available: 'boolean',
      })
    if (m.diagnostics) {
      expectFields(m.diagnostics as unknown as Record<string, unknown>, {
        appVersion: 'string',
        channel: 'string',
        os: 'string',
        arch: 'string',
        electron: 'string',
        chrome: 'string',
        node: 'string',
        locale: 'string',
        engines: 'object',
      })
    }
    if (m.error)
      expectFields(m.error as unknown as Record<string, unknown>, { text: 'string', sessionId: 'string', at: 'number' })
  }
}

describe.skipIf(files.length === 0)('云端契约样例：反馈', () => {
  for (const name of files) {
    const s = sample(name)
    const body = (s.body ?? {}) as Record<string, unknown>
    if (s.status >= 200 && s.status < 300 && Array.isArray(body.threads)) {
      it(`${name}：列表字段和类型符合 FeedbackList`, async () => {
        serve(s)
        const list = await api.listFeedback()
        expect(list.threads).toHaveLength((body.threads as unknown[]).length)
        expectFields(list as unknown as Record<string, unknown>, {
          unreadCount: 'number',
          nextBefore: ['string', 'null'],
        })
        for (const t of list.threads) {
          expectFields(t as unknown as Record<string, unknown>, SUMMARY)
          expect(['bug', 'feature', 'other']).toContain(t.type)
          expect(['open', 'replied', 'closed']).toContain(t.status)
          expect(['user', 'team']).toContain(t.previewAuthor)
          expect(t.createdAt).toBeGreaterThan(0)
          expect(t.updatedAt).toBeGreaterThan(0)
        }
      })
    } else if (s.status >= 200 && s.status < 300 && body.thread) {
      it(`${name}：详情字段和类型符合 FeedbackDetail`, async () => {
        serve(s)
        expectDetail(await api.getFeedback(ID))
      })
    } else if (s.status >= 400) {
      it(`${name}：HTTP ${s.status} 变成带 code 的中文错误`, async () => {
        serve(s)
        const message = typeof body.error === 'string' ? body.error : ''
        const code =
          ({ 400: 'INVALID', 404: 'NOT_FOUND', 413: 'TOO_LARGE', 429: 'RATE_LIMITED' } as Record<number, string>)[
            s.status
          ] ?? 'UNAVAILABLE'
        await expect(api.getFeedback(ID)).rejects.toMatchObject({ code, ...(message && { message }) })
      })
    }
  }

  it.skipIf(!has('feedback-list.json'))('feedback-list.json 的未读数', async () => {
    const s = sample('feedback-list.json')
    serve(s)
    const list = await api.listFeedback()
    expect(list.unreadCount).toBe((s.body as { unread_count: number }).unread_count)
  })
})
