// 事项（docs/ui/channels-collab-v2.md §9）：负责人选项、分配规则、验收标准的纯函数。不依赖 window
import type { AgentMember, Channel, ChannelMember } from '@/data/types'
import type { AcceptanceItem, IssueAssignee, ManualTask } from '../../../../shared/types/project-tools'
import { ACCEPTANCE_MAX } from '../../../../shared/types/project-tools'

export interface AssigneeChoice {
  /** 下拉框的值：频道 id + 成员 id */
  key: string
  assignee: IssueAssignee
  channel: string
}

export const assigneeKey = (a: Pick<IssueAssignee, 'channelId' | 'memberId'>): string => `${a.channelId}|${a.memberId}`

/** 可以交给谁：本机、没归档的频道里的 AI 成员；默认项目是这个项目的频道排前面 */
export function assigneeChoices(
  channels: readonly Channel[],
  members: readonly ChannelMember[],
  projectId: string | null,
): AssigneeChoice[] {
  const agents = new Map(members.filter((m): m is AgentMember => m.kind === 'agent').map(m => [m.id, m]))
  const usable = channels
    .filter(c => c.scope === 'local' && !c.archivedAt)
    .sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId))
  const out: AssigneeChoice[] = []
  for (const c of usable)
    for (const id of c.memberIds) {
      const m = agents.get(id)
      if (m)
        out.push({
          key: assigneeKey({ channelId: c.id, memberId: m.id }),
          assignee: { channelId: c.id, memberId: m.id, name: m.name },
          channel: c.name,
        })
    }
  return out
}

export type AssignRuleKind = 'tag' | 'project' | 'keyword'
export interface AssignRule {
  id: string
  kind: AssignRuleKind
  /** 标签名、项目 id 或标题里的词 */
  value: string
  assignee: IssueAssignee
}

/** 第一条命中的规则（标签、关键词不分大小写）；规则里的成员不在可选里了就跳过 */
export function matchRule(
  rules: readonly AssignRule[],
  task: Pick<ManualTask, 'title' | 'tags' | 'projectId'>,
  choices: readonly AssigneeChoice[],
): IssueAssignee | null {
  const keys = new Set(choices.map(c => c.key))
  const lower = (s: string) => s.trim().toLocaleLowerCase()
  for (const rule of rules) {
    const v = lower(rule.value)
    if (!v || !keys.has(assigneeKey(rule.assignee))) continue
    const hit =
      rule.kind === 'tag'
        ? task.tags.some(t => lower(t) === v)
        : rule.kind === 'project'
          ? task.projectId === rule.value
          : lower(task.title).includes(v)
    if (hit) return choices.find(c => c.key === assigneeKey(rule.assignee))!.assignee
  }
  return null
}

/** 输入框里一行一条 → 验收标准；原来勾过的同一条保持勾着 */
export function parseAcceptance(text: string, prior: readonly AcceptanceItem[] = []): AcceptanceItem[] {
  const done = new Map(prior.map(a => [a.text, a.done]))
  return text
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, ACCEPTANCE_MAX)
    .map(line => ({ text: line.slice(0, 300), done: done.get(line) ?? false }))
}

export const acceptanceText = (items: readonly AcceptanceItem[] = []): string => items.map(a => a.text).join('\n')

export const sameAcceptance = (a: readonly AcceptanceItem[] = [], b: readonly AcceptanceItem[] = []): boolean =>
  a.length === b.length && a.every((x, i) => x.text === b[i].text && x.done === b[i].done)

/** 能不能（再）交给负责人：有负责人、没完成也不在待验收、卡片没在跑 */
export function canDispatch(task: ManualTask): boolean {
  if (!task.assignee || task.status === 'completed' || task.status === 'review') return false
  return !task.link || task.link.state === 'failed' || task.link.state === 'stopped'
}

/** 打回的追加要求：@ 负责人写原因，列出没勾的验收标准 */
export function rejectRequest(
  task: Pick<ManualTask, 'acceptance'>,
  member: string,
  reason: string,
  t: { text(member: string, reason: string): string; unmet: string },
): string {
  const unmet = (task.acceptance ?? []).filter(a => !a.done)
  const parts = [t.text(member, reason.trim())]
  if (unmet.length) parts.push([t.unmet, ...unmet.map((a, i) => `${i + 1}. ${a.text}`)].join('\n'))
  return parts.join('\n\n')
}
