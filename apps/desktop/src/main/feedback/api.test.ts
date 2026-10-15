import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../account/account', () => ({ feedbackFetch: mocks.fetch }))

const api = await import('./api')

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), {
    status,
    headers,
  })

const ID = 'fb_abcdEFGH12345678'
const summary = {
  id: ID,
  type: 'bug',
  title: '卡住',
  status: 'replied',
  created_at: '2026-10-12T06:03:00Z',
  updated_at: '2026-10-12T10:20:00.5Z',
  unread: true,
  preview: '已修复',
  preview_author: 'team',
}

beforeEach(() => mocks.fetch.mockReset())

describe('解析', () => {
  it('列表：snake_case → camelCase，时间转毫秒', async () => {
    mocks.fetch.mockResolvedValue(reply(200, { threads: [summary, { nope: 1 }], unread_count: 2, next_before: 'c1' }))
    const list = await api.listFeedback('c0', 10)
    expect(mocks.fetch).toHaveBeenCalledWith('GET', '/v1/feedback?limit=10&before=c0', undefined, undefined)
    expect(list).toEqual({
      threads: [
        {
          id: ID,
          type: 'bug',
          title: '卡住',
          status: 'replied',
          createdAt: Date.parse('2026-10-12T06:03:00Z'),
          updatedAt: Date.parse('2026-10-12T10:20:00.5Z'),
          unread: true,
          preview: '已修复',
          previewAuthor: 'team',
          teamSeen: false,
          teamSeenAt: null,
          working: false,
          workingAt: null,
          messageCount: 0,
          attachments: { logs: 0, images: 0 },
        },
      ],
      unreadCount: 2,
      nextBefore: 'c1',
    })
  })

  it('列表：v2 新字段（团队看过、处理中、条数、附件数）', async () => {
    mocks.fetch.mockResolvedValue(
      reply(200, {
        threads: [
          {
            ...summary,
            team_seen: true,
            team_seen_at: '2026-10-12T07:00:00Z',
            working: true,
            working_at: '2026-10-12T08:00:00Z',
            message_count: 3,
            attachments: { logs: 1, images: 2 },
          },
          { ...summary, working: false, working_at: '2026-10-12T08:00:00Z' },
        ],
      }),
    )
    const [a, b] = (await api.listFeedback()).threads
    expect(a).toMatchObject({
      teamSeen: true,
      teamSeenAt: Date.parse('2026-10-12T07:00:00Z'),
      working: true,
      workingAt: Date.parse('2026-10-12T08:00:00Z'),
      messageCount: 3,
      attachments: { logs: 1, images: 2 },
    })
    // 没在处理时不给 workingAt
    expect(b.workingAt).toBeNull()
  })

  it('详情：丢掉后台才有的 note / assigned 消息', async () => {
    const m = (id: number, kind: string) => ({
      id,
      author: 'team',
      kind,
      body: 'x',
      created_at: '2026-10-12T06:03:00Z',
    })
    mocks.fetch.mockResolvedValue(
      reply(200, { thread: summary, messages: [m(1, 'message'), m(2, 'note'), m(3, 'assigned'), m(4, 'closed')] }),
    )
    expect((await api.getFeedback(ID)).messages.map(x => x.id)).toEqual([1, 4])
  })

  it('列表：next_before 为 null / 缺字段时不崩', async () => {
    mocks.fetch.mockResolvedValue(reply(200, { threads: [], unread_count: 0, next_before: null }))
    expect(await api.listFeedback()).toEqual({ threads: [], unreadCount: 0, nextBefore: null })
    mocks.fetch.mockResolvedValue(reply(200, {}))
    expect(await api.listFeedback()).toEqual({ threads: [], unreadCount: 0, nextBefore: null })
  })

  it('详情：消息、附件、诊断、报错片段、关闭信息', async () => {
    mocks.fetch.mockResolvedValue(
      reply(200, {
        thread: { ...summary, closed_by: 'team', closed_at: '2026-10-13T00:00:00Z' },
        messages: [
          {
            id: 1,
            author: 'user',
            kind: 'message',
            body: '正文',
            created_at: '2026-10-12T06:03:00Z',
            diagnostics: {
              app_version: '0.2.15',
              channel: 'installed',
              os: 'Windows',
              arch: 'x64',
              electron: '1',
              chrome: '2',
              node: '3',
              locale: 'zh',
              engines: [{ name: 'Claude', version: null, status: 'missing' }],
            },
            error: { text: '429', session_id: 's_1', at: '2026-10-12T06:02:00Z' },
            attachments: [
              {
                id: 7,
                kind: 'log',
                name: 'logs.txt',
                media_type: 'text/plain',
                size: 10,
                raw_size: 50,
                available: false,
              },
            ],
          },
          {
            id: 2,
            author: 'team',
            kind: 'closed',
            body: '',
            created_at: '2026-10-13T00:00:00Z',
            diagnostics: null,
            error: null,
            attachments: [],
          },
        ],
      }),
    )
    const d = await api.getFeedback(ID)
    expect(d.thread).toMatchObject({ closedBy: 'team', closedAt: Date.parse('2026-10-13T00:00:00Z') })
    expect(d.messages[0]).toMatchObject({
      diagnostics: { appVersion: '0.2.15', engines: [{ name: 'Claude', version: null, status: 'missing' }] },
      error: { text: '429', sessionId: 's_1', at: Date.parse('2026-10-12T06:02:00Z') },
      attachments: [{ id: 7, kind: 'log', mediaType: 'text/plain', size: 10, rawSize: 50, available: false }],
    })
    expect(d.messages[1]).toMatchObject({ author: 'team', kind: 'closed', diagnostics: null, error: null })
  })

  it('详情缺 thread 是 UNAVAILABLE', async () => {
    mocks.fetch.mockResolvedValue(reply(200, { messages: [] }))
    await expect(api.getFeedback(ID)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
})

describe('错误码', () => {
  const cases: [number, string, string][] = [
    [413, '太大了', 'TOO_LARGE'],
    [429, '提交太频繁', 'RATE_LIMITED'],
    [400, '标题不能为空', 'INVALID'],
    [503, '存储不可用', 'UNAVAILABLE'],
    [500, '出错', 'UNAVAILABLE'],
  ]
  it.each(cases)('HTTP %i → %s', async (status, error, code) => {
    mocks.fetch.mockResolvedValue(reply(status, { error }))
    await expect(api.closeFeedback(ID)).rejects.toMatchObject({ message: error, code })
  })

  it('404：列表是 NOT_DEPLOYED，其他是 NOT_FOUND', async () => {
    mocks.fetch.mockImplementation(async () => reply(404, 'not found'))
    await expect(api.listFeedback()).rejects.toMatchObject({ code: 'NOT_DEPLOYED' })
    await expect(api.getFeedback(ID)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('网络错误是 UNAVAILABLE，登录过期原样抛出', async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(api.listFeedback()).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    const expired = Object.assign(new Error('登录已失效'), { code: 'AUTH_EXPIRED' })
    mocks.fetch.mockRejectedValueOnce(expired)
    await expect(api.listFeedback()).rejects.toBe(expired)
  })
})

describe('请求', () => {
  it('编号先校验再拼路径', async () => {
    await expect(api.getFeedback('../x')).rejects.toMatchObject({ code: 'INVALID' })
    await expect(api.getFeedback('fb_short')).rejects.toMatchObject({ code: 'INVALID' })
    await expect(api.fetchAttachment(ID, 0)).rejects.toMatchObject({ code: 'INVALID' })
    await expect(api.fetchAttachment(ID, 1.5)).rejects.toMatchObject({ code: 'INVALID' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('新建和补充用 90 秒超时', async () => {
    mocks.fetch.mockImplementation(async () => reply(201, { thread: summary, messages: [] }))
    const msg = {
      body: 'b',
      client: { app_version: '1', channel: 'dev', os: 'o', arch: 'a', locale: 'zh' },
      diagnostics: null,
      error: null,
      attachments: [],
    }
    await api.createFeedback({ ...msg, type: 'bug', title: 't' })
    await api.replyFeedback(ID, msg)
    expect(mocks.fetch.mock.calls[0]).toEqual([
      'POST',
      '/v1/feedback',
      expect.objectContaining({ type: 'bug' }),
      90_000,
    ])
    expect(mocks.fetch.mock.calls[1]).toEqual(['POST', `/v1/feedback/${ID}/messages`, expect.anything(), 90_000])
  })

  it('附件取回字节和类型', async () => {
    mocks.fetch.mockResolvedValue(
      reply(200, new Uint8Array([1, 2, 3]), { 'Content-Type': 'text/plain; charset=utf-8' }),
    )
    const r = await api.fetchAttachment(ID, 7)
    expect(r.mediaType).toBe('text/plain')
    expect([...r.bytes]).toEqual([1, 2, 3])
    expect(mocks.fetch.mock.calls[0][1]).toBe(`/v1/feedback/${ID}/attachments/7`)
  })
})
