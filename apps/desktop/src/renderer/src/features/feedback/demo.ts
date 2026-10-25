// 演示模式（和没有桥的开发环境）的反馈：全在内存里，不联网、不弹通知（docs/ui/feedback.md §2.7）
import type { FeedbackBridge } from '../../../../preload/feedback'
import type {
  FeedbackAttachmentData,
  FeedbackAttachmentMeta,
  FeedbackChange,
  FeedbackCreateInput,
  FeedbackDetail,
  FeedbackDiagnostics,
  FeedbackMessage,
  FeedbackPreview,
  FeedbackReplyInput,
  FeedbackState,
  FeedbackSummary,
  FeedbackThread,
} from '../../../../shared/types/feedback'
import { tr } from '@/i18n/core'

export const DEMO_EMAIL = 'demo@pixelsky.local'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const DIAGNOSTICS: FeedbackDiagnostics = {
  appVersion: '0.3.7',
  channel: 'installed',
  os: 'Windows 11',
  arch: 'x64',
  electron: '35.0.0',
  chrome: '134.0.0',
  node: '22.0.0',
  locale: 'zh-CN',
  engines: [
    { name: 'Claude', version: '2.1.0', status: 'ready' },
    { name: 'Codex', version: '0.9.0', status: 'ready' },
  ],
}

const DIAGNOSTICS_TEXT = [
  'app: 0.3.7 (installed)',
  'os: Windows 11 x64',
  'electron: 35.0.0',
  'chrome: 134.0.0',
  'node: 22.0.0',
  'locale: zh-CN',
  'engines:',
  '  Claude 2.1.0 (ready)',
  '  Codex 0.9.0 (ready)',
].join('\n')

/** 示例截图：一张画好的小 SVG，用 data URL 显示 */
const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#1f2a26"/>' +
  '<rect x="16" y="16" width="130" height="168" rx="6" fill="#2d3d36"/><rect x="160" y="16" width="144" height="168" rx="6" fill="#2d3d36"/>' +
  '<rect x="28" y="32" width="90" height="8" rx="3" fill="#6fae95"/><rect x="172" y="32" width="100" height="8" rx="3" fill="#6fae95"/></svg>'

interface Entry {
  thread: FeedbackThread
  messages: FeedbackMessage[]
  /** 附件内容：附件 id → 内容 */
  blobs: Map<number, FeedbackAttachmentData>
}

const message = (
  id: number,
  over: Partial<FeedbackMessage> & Pick<FeedbackMessage, 'author' | 'body' | 'createdAt'>,
): FeedbackMessage => ({
  kind: 'message',
  diagnostics: null,
  error: null,
  attachments: [],
  ...over,
  id,
})

/** 条数、附件数跟着消息算（和云端一致：只数 kind=message） */
function withCounts(thread: FeedbackThread, messages: FeedbackMessage[]): FeedbackThread {
  const real = messages.filter(m => m.kind === 'message')
  const all = real.flatMap(m => m.attachments)
  return {
    ...thread,
    messageCount: real.length,
    attachments: { logs: all.filter(a => a.kind === 'log').length, images: all.filter(a => a.kind === 'image').length },
  }
}

function summaryOf(entry: Entry): FeedbackSummary {
  const { closedBy: _by, closedAt: _at, ...summary } = withCounts(entry.thread, entry.messages)
  return summary
}

export function createDemoFeedback(now: () => number = Date.now): FeedbackBridge {
  const t0 = now()
  const entries = new Map<string, Entry>()
  const listeners = new Set<(change: FeedbackChange) => void>()
  let seq = 0

  const logText = tr('feedback.demo.logs')
  const logMeta: FeedbackAttachmentMeta = {
    id: 1,
    kind: 'log',
    name: 'logs.txt',
    mediaType: 'text/plain',
    size: 1200,
    rawSize: 86 * 1024,
    available: true,
  }
  const imageMeta: FeedbackAttachmentMeta = {
    id: 1,
    kind: 'image',
    name: 'screenshot.svg',
    mediaType: 'image/svg+xml',
    size: SAMPLE_SVG.length,
    rawSize: SAMPLE_SVG.length,
    available: true,
  }
  const open = { closedBy: null, closedAt: null } as const
  const idle = {
    teamSeen: false,
    teamSeenAt: null,
    working: false,
    workingAt: null,
    messageCount: 0,
    attachments: { logs: 0, images: 0 },
  } as const
  entries.set('fb_demo0000000001', {
    thread: {
      ...open,
      ...idle,
      teamSeen: true,
      teamSeenAt: t0 - 20 * HOUR,
      working: true,
      workingAt: t0 - 5 * HOUR,
      id: 'fb_demo0000000001',
      type: 'bug',
      title: tr('feedback.demo.t1.title'),
      status: 'replied',
      createdAt: t0 - 1 * DAY,
      updatedAt: t0 - 2 * HOUR,
      unread: true,
      preview: tr('feedback.demo.t1.reply'),
      previewAuthor: 'team',
    },
    messages: [
      message(1, {
        author: 'user',
        body: tr('feedback.demo.t1.body'),
        createdAt: t0 - 1 * DAY,
        diagnostics: DIAGNOSTICS,
        error: { text: '429 rate limited: retry after 30s', sessionId: 's_ab12', at: t0 - 1 * DAY - 60_000 },
        attachments: [logMeta],
      }),
      message(2, { author: 'team', body: tr('feedback.demo.t1.reply'), createdAt: t0 - 2 * HOUR }),
    ],
    blobs: new Map([[1, { kind: 'log', text: logText }]]),
  })
  entries.set('fb_demo0000000002', {
    thread: {
      ...open,
      ...idle,
      teamSeen: true,
      teamSeenAt: t0 - 3 * DAY + 2 * HOUR,
      working: true,
      workingAt: t0 - 2 * DAY,
      id: 'fb_demo0000000002',
      type: 'feature',
      title: tr('feedback.demo.t2.title'),
      status: 'open',
      createdAt: t0 - 3 * DAY,
      updatedAt: t0 - 3 * DAY,
      unread: false,
      preview: tr('feedback.demo.t2.body'),
      previewAuthor: 'user',
    },
    messages: [
      message(1, {
        author: 'user',
        body: tr('feedback.demo.t2.body'),
        createdAt: t0 - 3 * DAY,
        attachments: [imageMeta],
      }),
    ],
    blobs: new Map([[1, { kind: 'image', mediaType: 'image/svg+xml', data: btoa(SAMPLE_SVG) }]]),
  })
  entries.set('fb_demo0000000003', {
    thread: {
      ...idle,
      teamSeen: true,
      teamSeenAt: t0 - 14 * DAY + HOUR,
      id: 'fb_demo0000000003',
      type: 'other',
      title: tr('feedback.demo.t3.title'),
      status: 'closed',
      createdAt: t0 - 14 * DAY,
      updatedAt: t0 - 13 * DAY,
      unread: false,
      preview: tr('feedback.demo.t3.reply'),
      previewAuthor: 'team',
      closedBy: 'team',
      closedAt: t0 - 13 * DAY,
    },
    messages: [
      message(1, { author: 'user', body: tr('feedback.demo.t3.body'), createdAt: t0 - 14 * DAY }),
      message(2, { author: 'team', body: tr('feedback.demo.t3.reply'), createdAt: t0 - 13 * DAY - HOUR }),
      message(3, { author: 'team', kind: 'closed', body: '', createdAt: t0 - 13 * DAY }),
    ],
    blobs: new Map(),
  })

  entries.set('fb_demo0000000004', {
    thread: {
      ...open,
      ...idle,
      teamSeen: true,
      teamSeenAt: t0 - 4 * HOUR,
      id: 'fb_demo0000000004',
      type: 'bug',
      title: tr('feedback.demo.t4.title'),
      status: 'open',
      createdAt: t0 - 6 * HOUR,
      updatedAt: t0 - 6 * HOUR,
      unread: false,
      preview: tr('feedback.demo.t4.body'),
      previewAuthor: 'user',
    },
    messages: [message(1, { author: 'user', body: tr('feedback.demo.t4.body'), createdAt: t0 - 6 * HOUR })],
    blobs: new Map(),
  })

  const sorted = (): FeedbackSummary[] => [...entries.values()].map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt)
  const unreadCount = (): number => [...entries.values()].filter(e => e.thread.unread).length
  const snapshot = (): FeedbackState => ({
    status: 'ready',
    email: DEMO_EMAIL,
    unreadCount: unreadCount(),
    threads: sorted(),
    nextBefore: null,
    error: null,
    checkedAt: now(),
  })
  const emit = (): void => {
    const change: FeedbackChange = { state: snapshot(), fresh: [] }
    listeners.forEach(fn => fn(change))
  }
  const detail = (entry: Entry): FeedbackDetail => ({
    thread: withCounts(entry.thread, entry.messages),
    messages: [...entry.messages],
  })
  const find = (id: string): Entry => {
    const entry = entries.get(id)
    if (!entry) throw new Error('NOT_FOUND')
    return entry
  }

  /** 把提交的日志、图片收进这条消息，返回附件信息 */
  const attach = (entry: Entry, input: FeedbackCreateInput | FeedbackReplyInput): FeedbackAttachmentMeta[] => {
    const metas: FeedbackAttachmentMeta[] = []
    let id = Math.max(0, ...entry.blobs.keys()) + 1
    if (input.logs) {
      const size = new TextEncoder().encode(input.logs).length
      metas.push({ id, kind: 'log', name: 'logs.txt', mediaType: 'text/plain', size, rawSize: size, available: true })
      entry.blobs.set(id++, { kind: 'log', text: input.logs })
    }
    for (const image of input.images) {
      const size = Math.floor((image.data.length * 3) / 4)
      metas.push({
        id,
        kind: 'image',
        name: image.name,
        mediaType: image.mediaType,
        size,
        rawSize: size,
        available: true,
      })
      entry.blobs.set(id++, { kind: 'image', mediaType: image.mediaType, data: image.data })
    }
    return metas
  }

  return {
    state: async () => snapshot(),
    refresh: async () => {
      emit()
      return snapshot()
    },
    list: async () => ({ threads: [], unreadCount: unreadCount(), nextBefore: null }),
    // 演示模式不弹通知
    pending: async () => [],
    ack: async () => {},
    markAllRead: async () => {
      let changed = false
      for (const entry of entries.values()) {
        if (entry.thread.unread) {
          entry.thread.unread = false
          changed = true
        }
      }
      if (changed) emit()
    },
    get: async id => {
      const entry = find(id)
      if (entry.thread.unread) {
        entry.thread.unread = false
        emit()
      }
      return detail(entry)
    },
    create: async input => {
      const at = now()
      const id = `fb_demo${String(++seq).padStart(10, '0')}x`
      const entry: Entry = {
        thread: {
          ...idle,
          id,
          type: input.type,
          title: input.title,
          status: 'open',
          createdAt: at,
          updatedAt: at,
          unread: false,
          preview: input.body,
          previewAuthor: 'user',
          closedBy: null,
          closedAt: null,
        },
        messages: [],
        blobs: new Map(),
      }
      entry.messages.push(
        message(1, {
          author: 'user',
          body: input.body,
          createdAt: at,
          diagnostics: input.diagnostics ? DIAGNOSTICS : null,
          error: input.error,
          attachments: attach(entry, input),
        }),
      )
      entries.set(id, entry)
      emit()
      return detail(entry)
    },
    reply: async (id, input) => {
      const entry = find(id)
      const at = now()
      if (entry.thread.status === 'closed') {
        entry.messages.push(
          message(entry.messages.length + 1, { author: 'user', kind: 'reopened', body: '', createdAt: at }),
        )
        entry.thread.closedBy = null
        entry.thread.closedAt = null
      }
      entry.messages.push(
        message(entry.messages.length + 1, {
          author: 'user',
          body: input.body,
          createdAt: at,
          diagnostics: input.diagnostics ? DIAGNOSTICS : null,
          error: input.error,
          attachments: attach(entry, input),
        }),
      )
      Object.assign(entry.thread, {
        status: 'open',
        teamSeen: false,
        teamSeenAt: null,
        updatedAt: at,
        preview: input.body,
        previewAuthor: 'user' as const,
      })
      emit()
      return detail(entry)
    },
    close: async id => {
      const entry = find(id)
      if (entry.thread.status !== 'closed') {
        const at = now()
        entry.messages.push(
          message(entry.messages.length + 1, { author: 'user', kind: 'closed', body: '', createdAt: at }),
        )
        Object.assign(entry.thread, {
          status: 'closed',
          working: false,
          workingAt: null,
          closedBy: 'user' as const,
          closedAt: at,
          updatedAt: at,
        })
        emit()
      }
      return detail(entry)
    },
    preview: async query => {
      const text = tr('feedback.demo.logs')
      const logs = query.logs
        ? {
            text,
            lines: text.split('\n').length,
            bytes: new TextEncoder().encode(text).length,
            truncated: false,
            since: query.logs.since,
            until: query.logs.until ?? now(),
          }
        : null
      return { diagnostics: DIAGNOSTICS, diagnosticsText: DIAGNOSTICS_TEXT, logs } satisfies FeedbackPreview
    },
    attachment: async (threadId, attachmentId) => {
      const blob = find(threadId).blobs.get(attachmentId)
      if (!blob) throw new Error('NOT_FOUND')
      return blob
    },
    onChange: cb => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}
