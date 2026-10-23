// 「需要你」（docs/ui/channels-collab-v2.md §2）：从本机频道的消息里找出等你处理的事和还在跟进的活。纯函数，不碰磁盘和引擎
import type { ChannelFollow, ChannelMessage, ChannelNeed, ChannelTask } from '../types/channels'
import { checkProblems } from '../types/checks'
import { threadMessages } from './threads'

const ACTIVE = new Set<ChannelTask['status']>(['queued', 'approval', 'running', 'waiting'])

/** 你在这张卡之后有没有回过它（引用、在串里发言）：回过就算「要你决定」处理了 */
function answered(list: readonly ChannelMessage[], task: ChannelTask, selfId: string): boolean {
  const since = task.endedAt ?? task.at
  // 卡片串里的都算：引用卡片或它的结果、发在串里（含在结果上开的串）
  return threadMessages(list, task.id).some(m => m.authorId === selfId && m.at > since)
}

function taskSession(list: readonly ChannelMessage[], taskId: string): string | null {
  const t = list.find(x => x.id === taskId)
  return t?.kind === 'task' ? (t.sessionId ?? null) : null
}

export function channelNeeds(
  channels: Iterable<{ id: string; archivedAt?: number | null }>,
  messages: ReadonlyMap<string, readonly ChannelMessage[]>,
  selfId: string,
): { needs: ChannelNeed[]; following: ChannelFollow[] } {
  const needs: ChannelNeed[] = []
  const following: ChannelFollow[] = []
  for (const c of channels) {
    if (c.archivedAt) continue
    const list = messages.get(c.id) ?? []
    for (const m of list) {
      const base = { channelId: c.id, at: m.at }
      if (m.kind === 'message') {
        if (m.proposal?.state === 'open')
          needs.push({
            ...base,
            key: `proposal:${m.id}`,
            kind: 'proposal',
            sig: 'open',
            memberId: m.proposal.assigneeId,
            messageId: m.id,
            text: m.proposal.request,
          })
        if (m.alert?.state === 'open')
          needs.push({
            ...base,
            key: `alert:${m.id}`,
            kind: 'alert',
            rule: m.alert.rule,
            sig: 'open',
            memberId: null,
            messageId: m.id,
            taskId: m.alert.taskId ?? null,
            sessionId: (m.alert.taskId && taskSession(list, m.alert.taskId)) || null,
            text: m.text,
          })
        continue
      }
      if (m.kind !== 'task') continue
      const task = {
        ...base,
        at: m.endedAt ?? m.at,
        memberId: m.assigneeId,
        taskId: m.id,
        sessionId: m.sessionId ?? null,
        text: m.title,
      }
      const round = m.round ?? 1
      if (m.status === 'waiting' && m.request)
        needs.push({
          ...task,
          key: `approval:${m.id}`,
          kind: 'approval',
          sig: m.request.requestId,
          request: m.request,
        })
      else if (m.status === 'queued' && m.relay?.held)
        needs.push({
          ...task,
          key: `held:${m.id}`,
          kind: 'held',
          sig: `${m.relay.held}:${m.relay.hop}`,
          detail: m.relay.held,
        })
      else if (m.status === 'failed')
        needs.push({ ...task, key: `failed:${m.id}`, kind: 'failed', sig: String(round), detail: m.error ?? null })
      else if (m.status === 'done') {
        const problems = m.checks?.status === 'done' ? checkProblems(m.checks) : null
        if (problems && (problems.failed.length || problems.findings.length))
          needs.push({
            ...task,
            key: `checks:${m.id}`,
            kind: 'checks',
            sig: m.checks!.id,
            detail: problems.failed.map(f => f.label).join(' · ') || null,
            findings: problems.findings.length,
          })
        if (m.decision && !answered(list, m, selfId))
          needs.push({ ...task, key: `decision:${m.id}`, kind: 'decision', sig: `${round}`, detail: m.decision })
      }
      if (ACTIVE.has(m.status) && !(m.status === 'queued' && m.relay?.held) && m.status !== 'waiting')
        following.push({
          channelId: c.id,
          taskId: m.id,
          memberId: m.assigneeId,
          title: m.title,
          status: m.status,
          at: m.at,
          sessionId: m.sessionId ?? null,
        })
    }
  }
  needs.sort((a, b) => b.at - a.at)
  following.sort((a, b) => b.at - a.at)
  return { needs, following }
}
