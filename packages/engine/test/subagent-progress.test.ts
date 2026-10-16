// 进度卡片「正在做什么」那一行的数据（docs/ui/progress-card.md §9）：摘要不被工具名盖掉，带上任务说明和派出它的调用
import { describe, expect, it } from 'vitest'
import type { EngineEvent, SubagentStatus } from '@pixelsky/protocol'
import { ClaudeTranslator } from '../src/claude/translate'

function make() {
  const events: EngineEvent[] = []
  const t = new ClaudeTranslator('D:\\work', {
    emit: e => events.push(e),
    sessionId: () => {},
    permissionMode: () => {},
    turnEnded: () => {},
    fastState: () => {},
  })
  const agents = (): SubagentStatus[] => {
    const last = events.filter(e => e.type === 'subagents').at(-1)
    return last && last.type === 'subagents' ? last.subagents : []
  }
  return { t, agents }
}

const progress = (t: ClaudeTranslator, extra: Record<string, unknown>) =>
  t.handle({ type: 'system', subtype: 'task_progress', task_id: 'a1', ...extra })

describe('子智能体进度', () => {
  it('带上任务说明和 Agent 调用；摘要来了之后，只带工具名的进度不再盖掉它；结束时记下结果', () => {
    const { t, agents } = make()
    t.startTurn('turn-1')
    t.handle({
      type: 'assistant',
      message: {
        id: 'm1',
        model: 'opus',
        content: [
          {
            type: 'tool_use',
            id: 'agent-1',
            name: 'Agent',
            input: {
              description: '找反馈入口',
              prompt: '  在 NoticeActions 里找能放「反馈」按钮的位置\n再看看 logs  ',
            },
          },
        ],
      },
    })
    t.handle({
      type: 'system',
      subtype: 'task_started',
      task_id: 'a1',
      task_type: 'local_agent',
      description: '找反馈入口',
      tool_use_id: 'agent-1',
    })
    expect(agents()[0]).toMatchObject({
      label: '找反馈入口',
      status: 'running',
      toolUseId: 'agent-1',
      task: '在 NoticeActions 里找能放「反馈」按钮的位置\n再看看 logs',
    })

    progress(t, { last_tool_name: 'Bash' })
    expect(agents()[0]).toMatchObject({ lastTool: 'Bash', message: 'Bash' })
    expect(agents()[0].summary).toBeUndefined()

    progress(t, { summary: '在 NoticeActions 和 LogsSection 里找位置', last_tool_name: 'Read' })
    progress(t, { last_tool_name: 'Grep' })
    expect(agents()[0]).toMatchObject({
      summary: '在 NoticeActions 和 LogsSection 里找位置',
      message: '在 NoticeActions 和 LogsSection 里找位置',
      lastTool: 'Grep',
    })

    t.handle({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'a1',
      status: 'completed',
      summary: '找到了两处。第一处在 NoticeActions',
    })
    expect(agents()[0]).toMatchObject({ status: 'completed', result: '找到了两处。第一处在 NoticeActions' })
  })
})
