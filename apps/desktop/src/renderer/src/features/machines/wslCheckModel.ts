// WSL 检查卡片的纯逻辑：项排序、每项怎么显示（wsl-mode.plan.md §3.3）
import type { CheckItem } from '../../../../shared/types/machines'

const ORDER: CheckItem['key'][] = ['start', 'encoding', 'node', 'claude', 'codex', 'login']

export const sortCheckItems = (items: CheckItem[]): CheckItem[] =>
  [...items].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))

/** 必需项都过了才能「开始使用」；没有检查结果算没过 */
export const requiredReady = (items: CheckItem[]): boolean =>
  items.some(i => i.key === 'start') && items.every(i => !i.required || i.status === 'ok')

interface CodeView {
  /** 右侧短说明用 detail 当哪个参数；不写就不传 */
  param?: 'version' | 'charmap'
  /** detail 另起一行（路径、原始错误）放在项下面 */
  line?: boolean
  /** 没有右侧短说明 */
  noShort?: boolean
  /** 我们已经自动处理了：图标按通过显示 */
  handled?: boolean
}
const CODES: Record<string, CodeView> = {
  WSL_START_FAILED: { line: true, noShort: true },
  WSL_HOME_EMPTY: {},
  ENCODING_NOT_UTF8: { param: 'charmap', handled: true },
  ENCODING_UNKNOWN: {},
  NODE_MISSING: {},
  NODE_OLD: { param: 'version' },
  NODE_BROKEN: { line: true },
  NODE_WINDOWS: { line: true },
  CLAUDE_MISSING: {},
  CLAUDE_WINDOWS: { line: true },
  CODEX_MISSING: {},
  CODEX_WINDOWS: { line: true },
}

export interface ItemView {
  /** 图标状态；已自动处理的项（如编码）按通过显示 */
  status: CheckItem['status']
  label: string
  /** 右侧：有已知原因码时是 short 文案，否则是 detail */
  short: { key: string; params?: Record<string, string> } | { text: string } | null
  /** detail 另起一行显示（等宽） */
  line: string | null
  /** 项下面的原因说明 */
  reason: string | null
  /** 修复命令（可复制） */
  fix: string | null
}

/** 返回 wslMessages 的 key，由界面翻译；detail 是原样的事实，不翻译 */
export function itemView(item: CheckItem): ItemView {
  const view = item.code ? CODES[item.code] : undefined
  // 登录项的 detail 是 'none' 或已登录的引擎名，要翻译
  const login = item.key === 'login' && !item.code
  const short = login
    ? item.detail === 'none' || !item.detail
      ? { key: 'wsl.login.none' }
      : { key: 'wsl.login.some', params: { who: item.detail } }
    : view?.noShort
      ? null
      : view
        ? { key: `wsl.short.${item.code}`, params: view.param ? { [view.param]: item.detail } : undefined }
        : item.detail
          ? { text: item.detail }
          : null
  const reason =
    view && item.code !== 'ENCODING_NOT_UTF8' && item.code !== 'ENCODING_UNKNOWN'
      ? `wsl.reason.${item.code}`
      : item.key === 'login' && item.status !== 'ok'
        ? 'wsl.reason.login'
        : null
  return {
    status: view?.handled ? 'ok' : item.status,
    label: `wsl.item.${item.key}`,
    short,
    line: view?.line && item.detail ? item.detail : null,
    reason,
    fix: item.fix ?? null,
  }
}
