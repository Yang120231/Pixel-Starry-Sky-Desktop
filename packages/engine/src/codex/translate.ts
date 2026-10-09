import type { AgentRun, EngineEvent, FileChange, Item, ItemStatus } from '@pixelsky/protocol'
import { array, object, string, number, type Message } from './process'

export function codexChanges(value: unknown): FileChange[] {
  return array(value)
    .map((raw): FileChange => {
      const change = object(raw),
        diff = string(change.diff),
        lines = diff.split('\n')
      const kind = string(object(change.kind).type || change.kind)
      return {
        path: string(change.path),
        kind: kind === 'add' ? 'add' : kind === 'delete' ? 'delete' : 'update',
        diff,
        added: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
        removed: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
      }
    })
    .filter(change => !!change.path)
}
const statusOf = (value: unknown, complete: boolean): ItemStatus =>
  value === 'failed'
    ? 'failed'
    : value === 'declined'
      ? 'declined'
      : value === 'interrupted'
        ? 'interrupted'
        : complete
          ? 'completed'
          : 'running'
/** 当前 thread 的条目转换；原生用户消息由宿主负责，只用于输入确认。 */
export class CodexTranslator {
  readonly items = new Map<string, Item>()
  private readonly agents = new Map<string, AgentRun>()
  constructor(private readonly emit: (event: EngineEvent) => void) {}
  item(raw: Message, complete: boolean): void {
    const id = 'cx-' + string(raw.id),
      type = string(raw.type),
      status = statusOf(raw.status, complete),
      prior = this.items.get(id)
    let item: Item | null = null
    if (type === 'agentMessage' || type === 'plan')
      item = {
        kind: 'assistant',
        id,
        text: string(raw.text) || (prior?.kind === 'assistant' ? prior.text : ''),
        status,
      }
    else if (type === 'reasoning')
      item = {
        kind: 'reasoning',
        id,
        text: array(raw.summary).map(string).join('\n\n') || (prior?.kind === 'reasoning' ? prior.text : ''),
        status,
      }
    else if (type === 'commandExecution')
      item = {
        kind: 'command',
        id,
        command: string(raw.command),
        description: string(raw.cwd) || null,
        output: string(raw.aggregatedOutput) || (prior?.kind === 'command' ? prior.output : ''),
        exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
        status,
      }
    else if (type === 'fileChange') item = { kind: 'file_change', id, changes: codexChanges(raw.changes), status }
    else if (type === 'contextCompaction')
      item = {
        kind: 'notice',
        id,
        level: 'info',
        text: complete ? 'Codex context compaction completed' : 'Codex is compacting context',
      }
    else if (type !== 'userMessage') {
      const tool =
        type === 'mcpToolCall'
          ? 'mcp'
          : type === 'webSearch'
            ? 'web'
            : /collab|subAgent/.test(type)
              ? 'task'
              : type === 'imageView'
                ? 'read'
                : 'other'
      item = {
        kind: 'tool',
        id,
        tool,
        name: type === 'mcpToolCall' ? `${string(raw.server)} / ${string(raw.tool)}` : type,
        title: string(raw.command || raw.query || raw.prompt || raw.path || raw.tool || raw.name) || type,
        output: raw.error ? JSON.stringify(raw.error) : raw.result ? JSON.stringify(raw.result) : string(raw.output),
        status,
      }
    }
    if (!item) return
    if (type === 'collabAgentToolCall' || type === 'collabToolCall') {
      const states = object(raw.agentsStates)
      for (const agentId of array(raw.receiverThreadIds ?? (raw.newThreadId ? [raw.newThreadId] : [])).map(string)) {
        if (!agentId) continue
        const state = object(states[agentId]),
          priorAgent = this.agents.get(agentId)
        this.agents.set(agentId, {
          id: agentId,
          label: agentId.slice(0, 8),
          type: 'Codex',
          model: string(raw.model) || priorAgent?.model || '',
          state: string(state.status) || (complete ? 'completed' : 'running'),
          startedAt: priorAgent?.startedAt ?? Date.now(),
          durationMs: 0,
          tokens: 0,
          toolCalls: 0,
          phase: null,
          prompt: string(raw.prompt) || priorAgent?.prompt || '',
          result: string(state.message),
          toolUseId: id,
        })
      }
      this.emit({ type: 'runs', runs: { workflows: [], agents: [...this.agents.values()] } })
      this.emit({
        type: 'subagents',
        subagents: [...this.agents.values()].map(agent => ({
          id: agent.id,
          label: agent.label,
          status: agent.state,
          message: agent.result || agent.prompt,
        })),
      })
    }
    this.items.set(id, item)
    this.emit({ type: complete ? 'item_completed' : 'item_started', item })
  }
  delta(method: string, params: Message): void {
    const id = 'cx-' + string(params.itemId),
      prior = this.items.get(id)
    if (!prior) {
      this.item(
        {
          id: params.itemId,
          type: method.includes('reasoning')
            ? 'reasoning'
            : method.includes('commandExecution')
              ? 'commandExecution'
              : 'agentMessage',
        },
        false,
      )
    }
    const item = this.items.get(id)
    if (!item) return
    const field = item.kind === 'command' || item.kind === 'tool' ? 'output' : 'text'
    const delta = string(params.delta)
    if (!delta) return
    if ('text' in item && field === 'text') this.items.set(id, { ...item, text: item.text + delta })
    else if ('output' in item) this.items.set(id, { ...item, output: item.output + delta })
    this.emit({ type: 'item_delta', itemId: id, field, delta })
  }
  plan(params: Message): void {
    const id = 'cx-plan-' + string(params.turnId)
    const item: Item = {
      kind: 'todo',
      id,
      steps: array(params.plan).map(v => {
        const p = object(v)
        return {
          text: string(p.step),
          status: p.status === 'completed' ? 'completed' : p.status === 'inProgress' ? 'in_progress' : 'pending',
        }
      }),
      status: 'running',
    }
    this.items.set(id, item)
    this.emit({ type: 'item_completed', item })
  }
  finish(outcome: ItemStatus): void {
    for (const item of this.items.values())
      if ('status' in item && item.status === 'running') {
        const finished = { ...item, status: outcome }
        this.items.set(item.id, finished)
        this.emit({ type: 'item_completed', item: finished })
      }
  }
}

export function tokenCounts(raw: unknown): {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  total: number
} {
  const value = object(raw),
    cacheRead = number(value.cachedInputTokens),
    cacheWrite = number(value.cacheWriteInputTokens)
  return {
    input: Math.max(0, number(value.inputTokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: number(value.outputTokens),
    total: number(value.totalTokens),
  }
}
