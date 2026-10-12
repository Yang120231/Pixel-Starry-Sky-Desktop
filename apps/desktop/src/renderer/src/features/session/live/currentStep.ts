// 运行中突出「现在在干什么」（docs/ui/conversation-concise.md §7）：纯函数，TurnProcess、LiveTranscript 和测试共用。
// 只看对话里已有的条目，不猜引擎下一步要干什么（没有「准备调用工具」这类信号前，等待时只说看结果 / 准备下一步 / 思考）。
import type { Item } from '@pixelsky/protocol'
import { tr, type TranslationKey } from '../../../i18n/core'

export type StepItem = Extract<Item, { kind: 'command' | 'file_change' | 'tool' | 'reasoning' }>

const isStep = (item: Item): item is StepItem =>
  item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool' || item.kind === 'reasoning'

/**
 * 正在进行的一步：最后开始的那个还在跑的工具调用 / 思考；more 是另外还在跑的个数（并行的子智能体等）。
 * 没有在跑的时为 null
 */
export function currentStep(items: readonly Item[]): { item: StepItem; more: number } | null {
  let item: StepItem | null = null,
    count = 0
  for (const it of items)
    if (isStep(it) && it.status === 'running') {
      item = it
      count++
    }
  return item ? { item, more: count - 1 } : null
}

/**
 * 两步之间（没有在跑的步骤、也没在输出文字）在等什么，按最后一条条目推断：
 * - result：工具调用刚结束，模型在看结果；
 * - next：一段话说完了、这一轮还没结束，在准备下一步；
 * - thinking：刚发了消息（或刚想完、只有提示），模型在思考。
 */
export type Waiting = 'result' | 'next' | 'thinking'

export function waitingFor(items: readonly Item[]): Waiting {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    // 信息提示、空白文字不算一步：接着往前看
    if ((item.kind === 'notice' && item.level === 'info') || (item.kind === 'assistant' && !item.text.trim())) continue
    if (item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool') return 'result'
    if (item.kind === 'assistant') return 'next'
    return 'thinking'
  }
  return 'thinking'
}

/** 等待超过这么久才显示已经等了几秒（短的等待一闪就过去，不用数） */
export const WAIT_CLOCK_MS = 5000
/** 一步运行超过这么久才显示用时 */
export const STEP_CLOCK_MS = 3000

/** 文件路径 → 文件名（显示「修改 Composer.tsx」） */
export const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/** 命令行只取第一行（多行脚本、heredoc 只显示开头） */
export const firstLine = (text: string): string => text.split('\n', 1)[0].trim()

const TOOL_STEP: Record<Extract<Item, { kind: 'tool' }>['tool'], TranslationKey> = {
  read: 'session.step.read',
  search: 'session.step.search',
  web: 'session.step.web',
  mcp: 'session.step.mcp',
  task: 'session.step.agent',
  other: 'session.step.tool',
}

/** 「执行」行上写的这一步：运行 pnpm test、修改 Composer.tsx、读取 a.ts、子智能体：审查代码、思考中 */
export function stepText(item: StepItem): string {
  switch (item.kind) {
    case 'reasoning':
      return tr('session.step.thinking')
    case 'command':
      // 有说明就用说明（「运行单元测试」），没有写命令本身
      return item.description?.trim() || tr('session.step.command', { text: firstLine(item.command) })
    case 'file_change': {
      const [first] = item.changes
      if (item.changes.length > 1) return tr('session.step.files', { n: item.changes.length })
      if (!first) return tr('session.step.files', { n: 0 })
      return tr(first.kind === 'add' ? 'session.step.create' : 'session.step.edit', { name: baseName(first.path) })
    }
    case 'tool':
      return tr(TOOL_STEP[item.tool], { text: firstLine(item.title), name: item.name })
  }
}

/** 正在跑的一步、等待的时长：一分钟内写整秒（12s），再长按 formatDuration（1m 05s） */
export function clockText(ms: number, long: (ms: number) => string): string {
  return ms < 60_000 ? tr('session.step.seconds', { n: Math.floor(ms / 1000) }) : long(ms)
}
