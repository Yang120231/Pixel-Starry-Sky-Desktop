import { tr } from '../i18n/core'
// 引擎相关的显示文字（中文）
import type { Effort, EngineId, FileChange, PermissionMode } from '@pixelsky/protocol'
import type { ChangedFiles } from '@/mock/types'

/** 推理强度用英文（和 JuCode 桌面版、Claude Code 一致） */
export const EFFORT_LABEL: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
}

/** 新会话默认的推理强度，也是「恢复默认」按钮回到的档位 */
export const DEFAULT_EFFORT: Effort = 'high'

export function effortLabel(e: Effort | null): string {
  return e ? EFFORT_LABEL[e] : 'Default'
}

/** 推理强度的强调色：引擎（模型）的品牌色，和 JuCode modelColor 一致；没有品牌色的引擎用正文色（空字符串） */
export function engineAccent(engine: EngineId): string {
  return engine === 'claude' ? 'var(--engine-claude)' : ''
}

/** Fast 模式开不了的原因（CLI 的 fast_mode_disabled_reason） */
const FAST_BLOCKED: Record<string, string> = {
  get free() { return tr("engine.labels.message483") },
  get preference() { return tr("engine.labels.message484") },
  get extra_usage_disabled() { return tr("engine.labels.message485") },
  get network_error() { return tr("engine.labels.message486") },
  get not_first_party() { return tr("engine.labels.message487") },
  get disabled_by_env() { return tr("engine.labels.message488") },
  get model_not_allowed() { return tr("session.ComposerMenus.message126") },
  get pending() { return tr("engine.labels.message489") },
}

export function fastBlockedText(reason: string): string {
  return FAST_BLOCKED[reason] ?? tr("engine.labels.message490")
}

/** 后台任务类型名 */
export function taskKindLabel(kind: string): string {
  if (kind.startsWith('local_workflow')) return tr("engine.labels.message491")
  if (kind.startsWith('local_bash')) return tr("engine.labels.message492")
  if (kind.startsWith('local_agent')) return tr("engine.labels.message493")
  if (kind.startsWith('monitor')) return tr("engine.labels.message494")
  return tr("engine.labels.message495")
}

export const PERMISSION_INFO: Record<PermissionMode, { label: string; hint: string }> = {
  ask: { get label() { return tr("engine.labels.message496") }, get hint() { return tr("engine.labels.message497") } },
  edits: { get label() { return tr("engine.labels.message498") }, get hint() { return tr("engine.labels.message499") } },
  plan: { get label() { return tr("engine.labels.message500") }, get hint() { return tr("engine.labels.message501") } },
  full: { get label() { return tr("engine.labels.message502") }, get hint() { return tr("engine.labels.message503") } },
}

/** 侧边栏右侧的相对时间：刚刚 / 5分钟 / 3小时 / 2天 / 10-05 */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000)
  if (s < 60) return tr("account.format.message0")
  if (s < 3600) return tr("engine.labels.message504", { p0: Math.floor(s / 60) })
  if (s < 86400) return tr("engine.labels.message505", { p0: Math.floor(s / 3600) })
  if (s < 86400 * 30) return tr("engine.labels.message506", { p0: Math.floor(s / 86400) })
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 统一协议的文件改动 → 「改动文件」卡片的数据（同一个文件多次改动合并） */
export function toChangedFiles(changes: FileChange[]): ChangedFiles | null {
  if (changes.length === 0) return null
  const byPath = new Map<string, { added: number; removed: number; newText?: string }>()
  for (const c of changes) {
    const prev = byPath.get(c.path) ?? { added: 0, removed: 0 }
    byPath.set(c.path, { added: prev.added + c.added, removed: prev.removed + c.removed, ...(c.newText ? { newText: c.newText } : prev.newText ? { newText: prev.newText } : {}) })
  }
  const files = [...byPath].map(([path, n]) => {
    const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return { dir: i >= 0 ? path.slice(0, i + 1) : '', name: i >= 0 ? path.slice(i + 1) : path, ...n }
  })
  return {
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    files,
  }
}

/**
 * 自有额度时可选的模型：引擎命令行认识的别名（Claude Code `--model opus` 等），null 表示跟随引擎自己的设置。
 * 平台额度的模型来自分组目录，不在这里（docs/ui/source-switch.md §3.2）。
 */
export const SELF_MODELS: Record<EngineId, Array<{ value: string | null; label: string; hint: string }>> = {
  claude: [
    { value: null, get label() { return tr("engine.labels.message507") }, get hint() { return tr("engine.labels.message508") } },
    { value: 'opus', label: 'Opus', get hint() { return tr("engine.labels.message509") } },
    { value: 'sonnet', label: 'Sonnet', get hint() { return tr("engine.labels.message510") } },
    { value: 'haiku', label: 'Haiku', get hint() { return tr("engine.labels.message511") } },
  ],
  codex: [{ value: null, get label() { return tr("engine.labels.message507") }, get hint() { return tr("engine.labels.message512") } }],
}

/** 自有模型的显示名：别名用表里的名字，完整模型名原样显示 */
export function selfModelLabel(engine: EngineId, model: string | null): string {
  return SELF_MODELS[engine].find((m) => m.value === model)?.label ?? model ?? tr("engine.labels.message507")
}
