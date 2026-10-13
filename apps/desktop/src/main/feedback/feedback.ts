// 设置 › 反馈的主进程部分（docs/ui/feedback.md §5）：IPC、轮询、通知去重。
// 系统通知由渲染层按通知设置决定弹不弹，这里只把「新出现的团队回复」随 feedback:changed 推过去。
import { join } from 'node:path'
import { app } from 'electron'
import { logger } from '@pixelsky/engine'
import * as ipc from '../ipc/guard'
import type { AppContext } from '../app/context'
import { appInfo } from '../app/info'
import { shrinkImage } from '../app/images'
import { logService } from '../app/logging'
import { windowLocale } from '../app/ui-language'
import { onAccountChange, signedInEmail } from '../account/account'
import {
  type FeedbackAttachmentData,
  type FeedbackCreateInput,
  type FeedbackDetail,
  type FeedbackDiagnostics,
  type FeedbackList,
  type FeedbackPreview,
  type FeedbackPreviewQuery,
  type FeedbackReplyInput,
  type FeedbackState,
  type FeedbackType,
} from '../../shared/types/feedback'
import {
  checkAttachmentId,
  checkThreadId,
  closeFeedback,
  createFeedback,
  fetchAttachment,
  FeedbackError,
  getFeedback,
  listFeedback,
  replyFeedback,
} from './api'
import { buildAttachFields, buildDiagnostics, buildLogs, checkBody, checkTitle, type MessageDeps } from './attachments'
import { FeedbackTracker, FileNotifiedStore } from './tracker'

const POLL_INTERVAL_MS = 10 * 60_000
const FOCUS_MIN_INTERVAL_MS = 60_000
/** 预览日志的默认时间窗 */
const DEFAULT_LOG_WINDOW_MS = 2 * 3_600_000

const log = logger('feedback')

function clientLocale(): string {
  return windowLocale().startsWith('zh') ? 'zh' : 'en'
}

function parseTime(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${name}不对`)
  return value
}

function parseType(value: unknown): FeedbackType {
  if (value === 'bug' || value === 'feature' || value === 'other') return value
  throw new Error('反馈类型不对')
}

/** 渲染层参数必须是对象 */
function asObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}参数不对`)
  return value as Record<string, unknown>
}

/** 日志服务没起来（例如测试环境）时给一个空读取器 */
const emptyLogs = { read: async () => [] }

export function initFeedback(ctx: AppContext): void {
  const tracker = new FeedbackTracker({
    list: () => listFeedback(null),
    store: new FileNotifiedStore(join(app.getPath('userData'), 'feedback.json')),
    emit: change => ctx.events.broadcast('feedback:changed', change),
  })

  async function engineBriefs(): Promise<{ name: string; version: string | null; status: string }[]> {
    try {
      const list = (await ctx.engine?.engines()) ?? []
      return list.map(e => ({ name: e.name, version: e.version, status: e.status }))
    } catch {
      return []
    }
  }

  const diagnostics = async (): Promise<ReturnType<typeof buildDiagnostics>> =>
    buildDiagnostics(appInfo(), await engineBriefs(), clientLocale())

  const deps: MessageDeps = {
    diagnostics: async (): Promise<FeedbackDiagnostics> => (await diagnostics()).diagnostics,
    client: () => {
      const info = appInfo()
      return { app_version: info.version, channel: info.channel, os: info.os, arch: info.arch, locale: clientLocale() }
    },
    shrink: shrinkImage,
  }

  /** 登录状态：没登录就不发请求 */
  const requireEmail = (): string => {
    const email = signedInEmail()
    if (!email) throw new Error('请先登录像素星空账号')
    return email
  }

  /** 提交 / 补充 / 打开 / 关闭之后顺便检查一次未读；检查结果不影响本次返回 */
  const afterAction = <T>(result: T): T => {
    void tracker.poll().catch(() => undefined)
    return result
  }

  const trackSignIn = (): void => {
    void tracker.setAccount(signedInEmail()).catch(() => undefined)
  }
  onAccountChange(trackSignIn)
  trackSignIn()

  setInterval(() => void tracker.poll().catch(() => undefined), POLL_INTERVAL_MS).unref()
  app.on('browser-window-focus', () => {
    if (tracker.sinceLastPoll() >= FOCUS_MIN_INTERVAL_MS) void tracker.poll().catch(() => undefined)
  })

  const deny = { deny: '不允许的调用方' }

  ipc.handle('feedback:state', (): FeedbackState => tracker.state(), deny)
  ipc.handle('feedback:refresh', (): Promise<FeedbackState> => tracker.poll(), deny)
  ipc.handle(
    'feedback:list',
    async (_event, before: unknown): Promise<FeedbackList> => {
      requireEmail()
      if (before !== null && before !== undefined && (typeof before !== 'string' || !before || before.length > 200))
        throw new Error('分页参数不对')
      return listFeedback(before ?? null)
    },
    deny,
  )
  ipc.handle(
    'feedback:get',
    async (_event, id: unknown): Promise<FeedbackDetail> => {
      requireEmail()
      return afterAction(await getFeedback(checkThreadId(id)))
    },
    deny,
  )
  ipc.handle(
    'feedback:create',
    async (_event, raw: unknown): Promise<FeedbackDetail> => {
      requireEmail()
      const input = asObject(raw, '反馈') as unknown as FeedbackCreateInput
      const type = parseType(input.type)
      const title = checkTitle(input.title)
      const body = checkBody(input.body)
      const fields = await buildAttachFields(input, deps)
      const detail = await createFeedback({ type, title, body, ...fields })
      log.info('提交反馈', { type, attachments: fields.attachments.length })
      return afterAction(detail)
    },
    deny,
  )
  ipc.handle(
    'feedback:reply',
    async (_event, id: unknown, raw: unknown): Promise<FeedbackDetail> => {
      requireEmail()
      const threadId = checkThreadId(id)
      const input = asObject(raw, '补充') as unknown as FeedbackReplyInput
      const body = checkBody(input.body)
      const fields = await buildAttachFields(input, deps)
      const detail = await replyFeedback(threadId, { body, ...fields })
      log.info('补充反馈', { attachments: fields.attachments.length })
      return afterAction(detail)
    },
    deny,
  )
  ipc.handle(
    'feedback:close',
    async (_event, id: unknown): Promise<FeedbackDetail> => {
      requireEmail()
      return afterAction(await closeFeedback(checkThreadId(id)))
    },
    deny,
  )
  ipc.handle(
    'feedback:preview',
    async (_event, raw: unknown): Promise<FeedbackPreview> => {
      const query = (raw ?? {}) as FeedbackPreviewQuery
      asObject(query, '预览')
      const d = await diagnostics()
      let logs = null
      if (query.logs !== undefined && query.logs !== null) {
        const w = asObject(query.logs, '日志时间窗')
        const until = w.until === undefined ? Date.now() : parseTime(w.until, '日志结束时间')
        const since = w.since === undefined ? until - DEFAULT_LOG_WINDOW_MS : parseTime(w.since, '日志开始时间')
        if (since >= until) throw new Error('日志时间窗不对')
        logs = await buildLogs(logService() ?? emptyLogs, since, until)
      }
      return { diagnostics: d.diagnostics, diagnosticsText: d.text, logs }
    },
    deny,
  )
  ipc.handle(
    'feedback:attachment',
    async (_event, threadId: unknown, attachmentId: unknown): Promise<FeedbackAttachmentData> => {
      requireEmail()
      const { bytes, mediaType } = await fetchAttachment(checkThreadId(threadId), checkAttachmentId(attachmentId))
      if (mediaType.startsWith('image/')) return { kind: 'image', mediaType, data: bytes.toString('base64') }
      if (mediaType.startsWith('text/')) return { kind: 'log', text: bytes.toString('utf8') }
      throw new FeedbackError('不支持的附件类型', 'INVALID')
    },
    deny,
  )
}
