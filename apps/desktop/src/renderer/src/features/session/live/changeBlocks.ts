// 对话流的显示块（从 LiveTranscript 抽出来，方便测试）：每轮的过程收成一行「执行」，连续的工具调用串成一组；
// 一轮（一条用户消息到下一条）的文件改动合成一张卡片，有子智能体改的按来源分组（docs/ui/subagent-changes.md）
import { isSubagentCall, isSubagentWork, type FoldOptions, type Item } from '@pixelsky/protocol'
import type { ChangedFileGroup, ChangedFiles } from '@/data'
import { toChangedFiles } from '@/features/engine/labels'
import { foldTurns } from './turnFold'

export type ToolItem = Extract<Item, { kind: 'command' | 'file_change' | 'tool' }>
type FileChangeItem = Extract<Item, { kind: 'file_change' }>

export type Block =
  | { type: 'item'; item: Item }
  | { type: 'tools'; key: string; items: ToolItem[] }
  /** 一轮的过程：收成一行「执行」，点开看里面的条目 */
  | { type: 'process'; key: string; items: Item[]; running: boolean; durationMs: number | null }
  /** turnKey：这一轮的用户消息 id，第一条用户消息之前的改动为 'start' */
  | { type: 'changes'; key: string; turnKey: string; data: ChangedFiles }

/**
 * 每轮改动卡片的数据缓存：这一轮的文件改动条目（对象本身）没变就复用上次的数据，
 * 流式输出时卡片的 props 不变，memo 才能跳过它（docs/ui/conversation-ux.md §2.7）
 */
export type ChangesCache = Map<string, { items: Item[]; data: ChangedFiles }>

export const sameItems = (a: readonly Item[], b: readonly Item[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i])

export function isTool(item: Item): item is ToolItem {
  return item.kind === 'command' || item.kind === 'file_change' || item.kind === 'tool'
}

const completedChange = (item: Item): item is FileChangeItem =>
  item.kind === 'file_change' && item.status === 'completed'

/**
 * 一轮的改动 → 卡片数据。有子智能体改的就按来源分组：主智能体在前，子智能体按第一次改文件的顺序；
 * 子智能体按派出它的 Agent 调用 id 区分（旧条目没有 id 时按名字）。标题的文件数、增删行数按路径合并后算
 */
export function roundChangedFiles(items: readonly FileChangeItem[]): ChangedFiles | null {
  const all = toChangedFiles(items.flatMap(item => item.changes))
  if (!all || !items.some(item => item.subagent)) return all
  const order: string[] = []
  const byGroup = new Map<string, { label: string | null; items: FileChangeItem[] }>()
  for (const item of items) {
    const key = item.subagent ? (item.subagentCall ?? `name:${item.subagent}`) : ''
    const group = byGroup.get(key)
    if (group) group.items.push(item)
    else {
      byGroup.set(key, { label: item.subagent ?? null, items: [item] })
      order.push(key)
    }
  }
  const groups: ChangedFileGroup[] = []
  for (const key of order.includes('') ? ['', ...order.filter(k => k !== '')] : order) {
    const group = byGroup.get(key)!
    const data = toChangedFiles(group.items.flatMap(item => item.changes))
    if (data) groups.push({ key: key || 'main', label: group.label, ...data })
  }
  return { ...all, groups }
}

/**
 * 把条目分成显示块。改动卡片一轮一张：放在这一轮最后一个结束点（统计行之前；空闲时尾部还有改动就放最后），
 * 后台子智能体跑完、主智能体被唤醒又结束一次时，卡片移到新的结束点并带上新的改动。
 * running 为真时最后一个结束点之后、正在跑的部分不算进卡片。
 * subagents: 'box'（docs/ui/subagent-box.md）：子智能体自己的条目不进对话流，但它们改的文件照旧算进改动卡片；
 * 派发子智能体的调用单独成块（显示成小框），不并进工具组
 */
export function toBlocks(items: Item[], running: boolean, cache: ChangesCache, options: FoldOptions = {}): Block[] {
  const box = options.subagents === 'box'
  // box：藏起来的子智能体文件改动，记在它前面最后一条显示出来的条目后面（key 为 '' 的在最前面），顺序和 inline 时一样
  const hiddenChanges = new Map<string, FileChangeItem[]>()
  if (box) {
    let prev = ''
    for (const item of items) {
      if (!isSubagentWork(item)) prev = item.id
      else if (completedChange(item)) {
        const list = hiddenChanges.get(prev)
        if (list) list.push(item)
        else hiddenChanges.set(prev, [item])
      }
    }
  }
  const blocks: Block[] = []
  let turnKey = 'start'
  /** 这一轮已完成的文件改动条目 */
  let round: FileChangeItem[] = []
  /** 卡片里算进去的条数、卡片在 blocks 里的位置（先占位，这一轮结束时只算一次数据，缓存才稳定） */
  let placed = 0
  let card = -1
  const placeCard = (): void => {
    if (round.length === placed) return
    if (card >= 0) blocks.splice(card, 1)
    placed = round.length
    card = blocks.length
    blocks.push({ type: 'changes', key: `changes-${turnKey}`, turnKey, data: EMPTY })
  }
  const finishRound = (): void => {
    if (card < 0) return
    const key = `changes-${turnKey}`
    const counted = round.slice(0, placed)
    const cached = cache.get(key)
    const data = cached && sameItems(cached.items, counted) ? cached.data : roundChangedFiles(counted)
    if (!data) {
      blocks.splice(card, 1)
      return
    }
    cache.set(key, { items: counted, data })
    blocks[card] = { type: 'changes', key, turnKey, data }
  }
  const flushHidden = (id: string): void => {
    const list = hiddenChanges.get(id)
    if (list) round.push(...list)
  }
  flushHidden('')
  for (const entry of foldTurns(items, running, options)) {
    if (entry.type === 'process') {
      for (const item of entry.items) {
        if (completedChange(item)) round.push(item)
        flushHidden(item.id)
      }
      blocks.push(entry)
      continue
    }
    const item = entry.item
    if (item.kind === 'user' && item.mode !== 'guidance') {
      // 上一轮最后一个结束点之后还有改动（例如中断了、没有统计行）：卡片放到这一轮末尾
      placeCard()
      finishRound()
      turnKey = item.id
      round = []
      placed = 0
      card = -1
    }
    // 一轮的统计放在这一轮最后（改动文件卡片之后），docs/ui/usage.md §4
    if (item.kind === 'turn_stats') placeCard()
    if (completedChange(item)) round.push(item)
    if (isTool(item) && !(box && isSubagentCall(item))) {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'tools') last.items.push(item)
      else blocks.push({ type: 'tools', key: `tools-${item.id}`, items: [item] })
    } else {
      blocks.push({ type: 'item', item })
    }
    flushHidden(item.id)
  }
  if (!running) placeCard()
  finishRound()
  return blocks
}

const EMPTY: ChangedFiles = { added: 0, removed: 0, files: [] }

/** 执行块里的条目：连续的工具调用串成一组 */
export function innerBlocks(items: Item[]): Block[] {
  const blocks: Block[] = []
  for (const item of items) {
    const last = blocks[blocks.length - 1]
    if (!isTool(item)) blocks.push({ type: 'item', item })
    else if (last?.type === 'tools') last.items.push(item)
    else blocks.push({ type: 'tools', key: `tools-${item.id}`, items: [item] })
  }
  return blocks
}

/**
 * 每个子智能体改了几个文件（按路径去重），给智能体追踪的总览用：
 * 键是派出它的 Agent 调用 id，旧条目没有 id 时另记一份 `name:名字`
 */
export function filesByAgent(items: readonly Item[]): Map<string, number> {
  const paths = new Map<string, Set<string>>()
  const add = (key: string, path: string): void => {
    const set = paths.get(key) ?? new Set<string>()
    set.add(path)
    paths.set(key, set)
  }
  for (const item of items) {
    if (!completedChange(item) || !item.subagent) continue
    for (const change of item.changes) {
      if (item.subagentCall) add(item.subagentCall, change.path)
      add(`name:${item.subagent}`, change.path)
    }
  }
  return new Map([...paths].map(([key, set]) => [key, set.size]))
}

/** 智能体追踪里一个子智能体改了几个文件：先按 Agent 调用 id 对，对不上再按名字 */
export const agentFileCount = (counts: Map<string, number>, toolUseId: string | null, label: string): number =>
  (toolUseId ? counts.get(toolUseId) : undefined) ?? counts.get(`name:${label}`) ?? 0
