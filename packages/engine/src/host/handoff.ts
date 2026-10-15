// 跨引擎接力：换引擎、给新引擎的交接、各引擎读到哪里的游标
// 应用自己保存一份完整对话；每个引擎有自己的原生会话，engineSessions[引擎].seen 是它上下文里最后一条对话条目
import { randomUUID } from 'node:crypto'
import {
  EMPTY_FLAGS,
  messageWithFiles,
  type EngineId,
  type EngineSessionState,
  type FileAttachment,
  type Item,
  type SessionRecord,
} from '@pixelsky/protocol'
import { buildHandoff, handoffEngines } from '../handoff'
import { ENGINES } from '../registry'
import type { HostContext } from './context'

/** 对话里最后一条条目的 id；没有为 null */
export const lastItemId = (items: readonly Item[]): string | null => items.at(-1)?.id ?? null

/**
 * 回退 / 分叉保留 items 之后，这个引擎上下文里最后一条对话条目：它最后处理的那条用户消息所在的一轮的末尾
 * （下一条普通用户消息之前，没有下一条就是最后一条）；它一条都没处理过为 null。untagged 的用户消息按 fallback 引擎算
 */
export function derivedSeen(items: readonly Item[], engine: EngineId, fallback: EngineId): string | null {
  let u = -1
  items.forEach((item, i) => {
    if (item.kind === 'user' && (item.engine ?? fallback) === engine) u = i
  })
  if (u < 0) return null
  const next = items.findIndex((item, i) => i > u && item.kind === 'user' && item.mode !== 'guidance')
  return (next < 0 ? items.at(-1) : items[next - 1])?.id ?? null
}

/** 新引擎收到的这条消息要不要带交接 */
export interface HandoffPlan {
  /** 真正发给引擎的文字（可能带着交接材料） */
  text: string
  /** 放在用户消息前面的提示条目，detail 是交接材料原文 */
  notice: Item | null
  /** 斜杠命令（如 /compact）本该带交接但没带：这一轮结束时不推进游标，交接留给下一条普通消息 */
  hold: boolean
}

export class HostHandoff {
  constructor(private readonly ctx: HostContext) {}

  /**
   * 把会话换到另一个引擎。只在空闲、没有在派发时调用（或由派发自己调用）：
   * 关掉当前进程，存好当前引擎的原生会话和游标，取出目标引擎以前的（没有就新建一个）。
   */
  async switchEngine(id: string, target: EngineId): Promise<void> {
    const { ctx } = this
    const m = ctx.m
    const rt = m.sessions.runtime(id)
    if (rt.snapshot.record.engine === target) return
    const adapter = ctx.adapters[target]
    if (!adapter) throw new Error('这个引擎暂不支持')
    if (rt.idleTimer) {
      clearTimeout(rt.idleTimer)
      rt.idleTimer = null
    }
    const old = rt.session
    rt.session = null
    await old?.close()
    // 关进程期间记录可能变了（引擎回报的会话 id 等），换引擎用最新的
    const record = rt.snapshot.record
    if (record.engine === target) return
    // 没打过标记的用户消息都是当前引擎处理的（以前不能换引擎）；补上标记，之后才分得清是谁处理的
    let items = rt.snapshot.items
    if (items.some(item => item.kind === 'user' && !item.engine)) {
      items = items.map(item => (item.kind === 'user' && !item.engine ? { ...item, engine: record.engine } : item))
      rt.snapshot = { ...rt.snapshot, items }
      ctx.store.replaceItems(id, items)
    }
    const map: Partial<Record<EngineId, EngineSessionState>> = { ...(record.engineSessions ?? {}) }
    const prev = map[record.engine]
    // 旧记录（没有 engineSessions）：当前引擎看到了全部对话
    map[record.engine] = {
      id: record.engineSessionId,
      seen: prev ? prev.seen : record.engineSessions ? null : lastItemId(items),
      ...(record.pendingRewind ? { pendingRewind: record.pendingRewind } : {}),
      ...(record.pendingFork ? { pendingFork: record.pendingFork } : {}),
    }
    const entry = map[target]
    // 引擎自己分配会话 id（Codex）时写 null，启动时新建；其他引擎预先给一个。
    // Claude 不能留 null：它会退回用会话自己的 id，那下面可能已经有一份旧记录
    const fresh = adapter.enginePicksSessionId ? null : randomUUID()
    const engineSessionId = entry?.id ?? fresh
    map[target] = { id: engineSessionId, seen: entry?.id ? entry.seen : null }
    const caps = ENGINES[target].caps
    m.events.patchRecord(id, {
      engine: target,
      nextEngine: null,
      engineSessionId,
      engineSessions: map,
      pendingRewind: entry?.pendingRewind ?? null,
      pendingFork: entry?.pendingFork ?? null,
      // 目标引擎没有的开关和强度档位清掉
      ...(!caps.ultracode && record.ultracode ? { ultracode: false } : {}),
      ...(!caps.fast && record.fast ? { fast: false } : {}),
      ...(!caps.thinkingSummaries && record.thinkingSummaries ? { thinkingSummaries: false } : {}),
      ...(record.effort && !caps.efforts.includes(record.effort) ? { effort: null } : {}),
    })
    this.resetRuntimeState(id)
  }

  /** 换引擎后界面不能再显示旧引擎的运行时状态（上下文用量、能力标记、后台任务、输入建议） */
  private resetRuntimeState(id: string): void {
    const { ctx } = this
    const m = ctx.m
    const rt = m.sessions.runtime(id)
    m.cache.reset(id)
    m.events.apply(id, { type: 'flags', flags: EMPTY_FLAGS })
    if (rt.snapshot.context) m.events.apply(id, { type: 'context', context: null })
    if (rt.snapshot.suggestion) m.events.apply(id, { type: 'suggestion', text: null })
    if (rt.snapshot.tasks.length) m.events.apply(id, { type: 'tasks', tasks: [] })
    if (rt.snapshot.subagents.length) m.events.apply(id, { type: 'subagents', subagents: [] })
    if (rt.snapshot.commands?.length) m.events.apply(id, { type: 'commands', commands: [] })
    if (rt.snapshot.background) m.events.apply(id, { type: 'background', count: 0 })
    let runs = { workflows: [], agents: [] } as typeof rt.snapshot.runs
    try {
      runs = ctx.adapters[rt.snapshot.record.engine]?.loadRuns?.(rt.snapshot.record) ?? runs
    } catch {
      // 读不到追踪数据不影响换引擎
    }
    m.events.apply(id, { type: 'runs', runs })
  }

  /**
   * 派发一条消息前算要不要给引擎带交接：它没看过的对话（游标之后的，或游标不在了就是全部）整理成材料。
   * 旧记录（没有 engineSessions）当前引擎看到了全部对话，不带。
   */
  plan(id: string, record: SessionRecord, text: string, files: FileAttachment[] | undefined): HandoffPlan {
    const rt = this.ctx.m.sessions.runtime(id)
    const body = messageWithFiles(text, files)
    const plain: HandoffPlan = { text: body, notice: null, hold: false }
    if (!record.engineSessions) return plain
    const prior = rt.snapshot.items
    const seen = record.engineSessions[record.engine]?.seen ?? null
    const at = seen === null ? -1 : prior.findIndex(item => item.id === seen)
    const delta = at >= 0 ? prior.slice(at + 1) : prior
    const mode = at >= 0 ? 'delta' : 'full'
    const built = buildHandoff({
      items: delta,
      mode,
      target: record.engine,
      conversationId: id,
      historyTool: this.ctx.opts.historyTool?.(record) ?? false,
    })
    if (!built) return plain
    // 斜杠命令（/compact 等）要原样交给引擎，不能前面加东西；交接留给下一条普通消息
    if (text.trimStart().startsWith('/')) return { ...plain, hold: true }
    const name = ENGINES[record.engine].name
    const others = handoffEngines(delta, record.engine)
    return {
      text: `${built.text}\n\n${body}`,
      hold: false,
      notice: {
        kind: 'notice',
        id: randomUUID(),
        level: 'info',
        text:
          mode === 'full'
            ? `已把之前的对话交接给 ${name}（${built.count} 条）`
            : `已把 ${others.length ? others.map(e => ENGINES[e].name).join('、') : '其他引擎'} 期间的进展同步给 ${name}`,
        detail: built.text,
      },
    }
  }
}
