// 输入框上方的「模式胶囊」文字（C1 只读，docs/mobile-remote.md §21.12.3）：「每步问我 · Sonnet 4.5 · 中」
import type { Effort, PermissionMode, SessionSettings } from '@pixelsky/protocol'

const PERMISSION: Record<PermissionMode, string> = {
  ask: '每步问我',
  edits: '自动改文件',
  plan: '只规划',
  full: '完全放行',
}

const EFFORT: Record<Effort, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
  ultra: '极致',
}

const MAX_RAW = 16

/**
 * 模型名简化：claude-sonnet-4-5-2025… → 「Sonnet 4.5」，claude-3-5-sonnet-… → 「Sonnet 3.5」，别名 sonnet → 「Sonnet」；
 * 认不出的显示原文，太长截断。手机拿不到模型目录，自定义模型名只能这样猜（C2 开放 catalog 后换正式名）。
 */
export function modelLabel(model: string): string {
  const name = model.trim().replace(/\[\w+\]$/, '')
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1).toLowerCase()
  const next = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(name)
  if (next) return `${cap(next[1])} ${next[2]}${next[3] ? `.${next[3]}` : ''}`
  const old = /^claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)(?!\w)/i.exec(name)
  if (old) return `${cap(old[3])} ${old[1]}${old[2] ? `.${old[2]}` : ''}`
  if (/^(opus|sonnet|haiku)$/i.test(name)) return cap(name)
  return name.length > MAX_RAW ? `${name.slice(0, MAX_RAW)}…` : name
}

export interface ModeChip {
  permission: string
  /** 没指定模型（用引擎默认）时为 null，不显示 */
  model: string | null
  /** 没指定强度时为 null，不显示 */
  effort: string | null
}

export function modeChip(record: Pick<SessionSettings, 'permissionMode' | 'model' | 'effort'>): ModeChip {
  return {
    permission: PERMISSION[record.permissionMode] ?? record.permissionMode,
    model: record.model ? modelLabel(record.model) : null,
    effort: record.effort ? (EFFORT[record.effort] ?? record.effort) : null,
  }
}
