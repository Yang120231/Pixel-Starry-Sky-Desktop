import { tr } from '../../../i18n/core'
// 错误卡片的归类（纯函数，NoticeActions 和测试共用；docs/ui/source-switch.md §3.5）
import type { SessionRecord } from '@pixelsky/protocol'

export type ErrorKind = 'auth' | 'balance' | 'route' | 'busy'

/** 按错误文字归类（Claude Code 的错误码已在引擎里翻成中文，平台代理 / 适配层返回中文或 HTTP 状态码） */
export function classifyError(text: string): ErrorKind | null {
  if (/登录已失效|已退出或切换|已改用自有|authentication|unauthori[sz]ed|\b401\b/i.test(text)) return 'auth'
  if (/余额|账单|billing|insufficient|quota|\b402\b/i.test(text)) return 'balance'
  if (/分组|线路|找不到所选模型|not available|model_not_found|forbidden|\b403\b|\b404\b/i.test(text)) return 'route'
  if (/频繁|限额|繁忙|rate.?limit|overloaded|\b429\b|\b529\b/i.test(text)) return 'busy'
  return null
}

/** 平台会话里的「登录已失效」不是 Claude Code 自己的登录：换成平台的说法 */
export function platformNoticeText(record: Pick<SessionRecord, 'platform'>, text: string): string {
  if (record.platform && /^登录已失效/.test(text)) return tr("session.live.errorKind.message240")
  return text
}
