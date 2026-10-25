// 悬停卡上的标题和说明（docs/ui/sidebar-status-icons.md §3）。纯函数，单独放出来好测（卡片组件连着各种 store）。
import { tr, translateMessage } from '@/i18n/core'
import type { SessionRecord } from '@pixelsky/protocol'
import type { SessionCard } from '@/features/board/sessionLanes'
import { platformNoticeText } from '@/features/session/live/errorKind'
import { resetClock, durationText } from '@/features/session/quota/quotaModel'
import type { StatusKind } from './sessionStatusModel'

/** 标题、说明（命令 / 路径 / 错误原文这类用等宽字）、补充一句；PR 的标题卡片自己画，这里给空 */
export function describeTopic(
  topic: StatusKind,
  input: {
    card: SessionCard | null
    record: (Pick<SessionRecord, 'platform' | 'provider'> & { cwd?: string }) | undefined
    machineName?: string
    machineError?: string | null
    error: string
    /** 在等额度恢复：下一次自动继续的时间点 */
    limitAt?: number | null
    now?: number
  },
): { title: string; detail: string; note?: string; mono?: boolean } {
  const request = input.card?.request ?? null
  switch (topic) {
    case 'approve': {
      const changes = request?.changes ?? []
      const detail =
        request?.command?.trim() ||
        request?.toolName ||
        (changes.length > 1
          ? tr('sidebar.status.files', { path: changes[0].path, count: changes.length - 1 })
          : changes[0]?.path) ||
        request?.description ||
        ''
      return {
        title: request?.title
          ? tr('sidebar.status.title.approve', { title: request.title })
          : tr('sidebar.status.title.approveBare'),
        detail,
        mono: !!request?.command,
      }
    }
    case 'question':
      return {
        title: tr('sidebar.status.title.question'),
        detail: request?.questions?.[0]?.question ?? request?.title ?? '',
      }
    case 'folder':
      return {
        title: tr('sidebar.status.title.folder'),
        detail: input.record?.cwd ?? '',
        note: tr('sidebar.status.folderGone'),
        mono: true,
      }
    case 'offline':
      return {
        title: tr('sidebar.status.title.offline', { name: input.machineName || tr('sidebar.status.machine') }),
        detail: input.machineError || tr('sidebar.status.noDetail'),
      }
    case 'paused':
      return {
        title: tr('sidebar.status.title.paused', {
          count: (input.card?.queue?.queued ?? 0) + (input.card?.queue?.failed ?? 0),
        }),
        detail: '',
      }
    case 'limit': {
      const now = input.now ?? Date.now()
      const at = input.limitAt ?? now
      return {
        title: tr('sidebar.status.limit.title'),
        detail: tr('sidebar.status.limit.detail', { p0: resetClock(at, now), p1: durationText(Math.max(0, at - now)) }),
        note: tr('sidebar.status.limit.note'),
      }
    }
    case 'auth':
    case 'balance':
    case 'route':
    case 'busy':
    case 'failed': {
      const text = input.error ? translateMessage(input.error) : tr('sidebar.status.noDetail')
      return {
        title: tr(`sidebar.status.title.${topic}`),
        detail: input.record ? platformNoticeText(input.record, text) : text,
      }
    }
    // PR 卡片自己画标题；running / unread 不弹卡
    default:
      return { title: '', detail: '' }
  }
}
