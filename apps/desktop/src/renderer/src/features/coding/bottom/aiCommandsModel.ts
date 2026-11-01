// AI 命令页的纯逻辑：从会话条目里取 kind: 'command' 的条目。
// 不算用时：item 上没有时间字段。
import type { Item } from '@pixelsky/protocol'

export const MAX_COMMANDS = 200
export const MAX_OUTPUT_CHARS = 40_000

export type AiCommandStatus = Extract<Item, { kind: 'command' }>['status']
export interface AiCommandEntry {
  id: string
  command: string
  description: string | null
  status: AiCommandStatus
  output: string
  exitCode: number | null
  subagent?: string
  /** 原条目（快照里的那个对象）：选中时按它取完整输出（useItemBody；跑着时记下完整版，跑完截成头尾不闪） */
  item: Item
}

/** 输出太长时留最后的部分（最新的内容更有用） */
export function clipOutput(output: string, limit = MAX_OUTPUT_CHARS): string {
  return output.length > limit ? output.slice(output.length - limit) : output
}

/** 选中那条显示的输出：截过的取到完整的一条（useItemBody(entry.item)）后同样只留最后一段 */
export const entryOutput = (entry: AiCommandEntry, full: Item | undefined): string =>
  full?.kind === 'command' && full.cutChars === undefined ? clipOutput(full.output) : entry.output

/** 取出所有命令条目，最多保留最近 200 条，每条输出最多 40 000 字 */
export function aiCommandEntries(items: readonly Item[]): AiCommandEntry[] {
  const entries: AiCommandEntry[] = []
  for (const item of items) {
    if (item.kind !== 'command') continue
    entries.push({
      id: item.id,
      command: item.command,
      description: item.description,
      status: item.status,
      output: clipOutput(item.output),
      exitCode: item.exitCode,
      ...(item.subagent ? { subagent: item.subagent } : {}),
      item,
    })
  }
  return entries.length > MAX_COMMANDS ? entries.slice(entries.length - MAX_COMMANDS) : entries
}

export interface AiCommandSummary {
  total: number
  running: number
  failed: number
}
export function summarizeAiCommands(entries: readonly AiCommandEntry[]): AiCommandSummary {
  let running = 0
  let failed = 0
  for (const entry of entries) {
    if (entry.status === 'running') running++
    else if (commandTone(entry) === 'failed') failed++
  }
  return { total: entries.length, running, failed }
}

/** 状态点用的粗分类 */
export function commandTone(entry: AiCommandEntry): 'running' | 'failed' | 'done' {
  if (entry.status === 'running') return 'running'
  if (entry.status === 'failed' || entry.status === 'declined' || (entry.exitCode !== null && entry.exitCode !== 0))
    return 'failed'
  return 'done'
}
