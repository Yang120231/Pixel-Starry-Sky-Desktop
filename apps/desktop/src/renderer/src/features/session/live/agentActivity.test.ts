import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { activityTooltip, agentActivity, agentSteps, agoText, firstSentence, runActivity } from './agentActivity'

const cmd = (id: string, command: string, call = 'ag1', description: string | null = null): Item => ({
  kind: 'command',
  id,
  command,
  description,
  output: '',
  exitCode: null,
  status: 'running',
  subagent: '子智能体',
  subagentCall: call,
})
const read = (id: string, title: string, call = 'ag1'): Item => ({
  kind: 'tool',
  id,
  tool: 'read',
  name: 'Read',
  title,
  output: '',
  status: 'completed',
  subagent: '子智能体',
  subagentCall: call,
})
const edit = (id: string, path: string): Item => ({
  kind: 'file_change',
  id,
  changes: [{ path, kind: 'update', diff: '', added: 1, removed: 0 }],
  status: 'completed',
  subagent: '子智能体',
  subagentCall: 'ag1',
})
const mine: Item = {
  kind: 'command',
  id: 'main',
  command: 'ls',
  description: null,
  output: '',
  exitCode: 0,
  status: 'completed',
}

describe('agentSteps', () => {
  it('按派出它的 Agent 调用分开，主智能体自己的不算', () => {
    const steps = agentSteps([cmd('c1', 'ls'), mine, read('r1', 'a.ts', 'ag2'), read('r2', 'b.ts')])
    expect(steps.get('ag1')?.map(s => s.id)).toEqual(['c1', 'r2'])
    expect(steps.get('ag2')?.map(s => s.id)).toEqual(['r1'])
    expect([...steps.keys()]).not.toContain(undefined)
  })
})

describe('agentActivity：跑着', () => {
  const steps = agentSteps([
    read('r1', 'features/logs/LogsSection.tsx'),
    cmd('c1', 'rg -n "查看日志" apps/desktop/src\nmore'),
  ]).get('ag1')!

  it('有摘要写摘要，不被最近一步盖掉', () => {
    expect(agentActivity({ state: 'running', summary: '在 NoticeActions 里找位置' }, steps)).toEqual({
      kind: 'summary',
      text: '在 NoticeActions 里找位置',
      full: '在 NoticeActions 里找位置',
    })
  })

  it('没有摘要写最近一步，说法和对话里的工具行一样，命令只取第一行；不出现工具名', () => {
    const line = agentActivity({ state: 'running', task: '找位置' }, steps)!
    expect(line).toMatchObject({ kind: 'step', stepId: 'c1' })
    expect(line.text).toContain('rg -n "查看日志" apps/desktop/src')
    expect(line.text).not.toContain('more')
    expect(line.text).not.toMatch(/Bash|Read|Grep/)
  })

  it('命令有说明时行上写说明，悬停写完整命令', () => {
    const [step] = agentSteps([cmd('c2', 'pnpm vitest run', 'ag1', '跑单元测试')]).get('ag1')!
    const line = agentActivity({ state: 'running' }, [step])!
    expect(line.text).toBe('跑单元测试')
    expect(line.full).toContain('pnpm vitest run')
  })

  it('一步都还没做写「任务：」加任务说明的第一行；什么都没有为 null', () => {
    expect(agentActivity({ state: 'running', task: '读记录，整理结构\n第二行' })).toMatchObject({
      kind: 'task',
      text: '任务：读记录，整理结构',
      full: '读记录，整理结构\n第二行',
    })
    expect(agentActivity({ state: 'running' })).toBeNull()
  })
})

describe('agentActivity：结束', () => {
  it('完成、失败写结果的第一句', () => {
    expect(agentActivity({ state: 'done', result: '重复占位符现在带上默认文本。19 个用例通过' })).toMatchObject({
      kind: 'done',
      text: '完成：重复占位符现在带上默认文本。',
    })
    expect(agentActivity({ state: 'failed', result: 'prettier 有 1 个文件格式不对' })).toMatchObject({
      kind: 'failed',
      text: '失败：prettier 有 1 个文件格式不对',
    })
    expect(agentActivity({ state: 'done' })).toBeNull()
  })

  it('停掉的写停下时在做的那一步；没有步骤时用摘要', () => {
    const steps = agentSteps([read('r1', 'docs/engines.md')]).get('ag1')!
    expect(agentActivity({ state: 'stopped', summary: '在找' }, steps)).toMatchObject({ kind: 'stopped', stepId: 'r1' })
    expect(agentActivity({ state: 'stopped', summary: '在找文档' })?.text).toBe('停下时在：在找文档')
    expect(agentActivity({ state: 'stopped' })).toBeNull()
  })
})

describe('其余', () => {
  it('第一句：中文句号、英文句号后跟空格才断，不切开 a.ts、v1.2', () => {
    expect(firstSentence('改好了。还有别的')).toBe('改好了。')
    expect(firstSentence('Fixed a.ts and v1.2. Then ran tests')).toBe('Fixed a.ts and v1.2.')
    expect(firstSentence('第一行\n第二行')).toBe('第一行')
  })

  it('几秒前：3 秒内刚刚，一分钟内写秒，再久写分钟', () => {
    expect(agoText(1000)).toBe('刚刚')
    expect(agoText(8500)).toBe('8 秒前')
    expect(agoText(125_000)).toBe('2 分钟前')
  })

  it('悬停：完整的一句，下面列最近 3 步（最新的在上）', () => {
    const steps = agentSteps([
      read('r1', 'a.ts'),
      read('r2', 'b.ts'),
      edit('e1', 'src/c.ts'),
      cmd('c1', 'git log -5'),
    ]).get('ag1')!
    const tip = activityTooltip({ kind: 'summary', text: 'x', full: '完整摘要' }, steps, () => 0, 9000).split('\n')
    expect(tip[0]).toBe('完整摘要')
    expect(tip[1]).toBe('最近：')
    expect(tip).toHaveLength(5)
    expect(tip[2]).toContain('git log -5')
    expect(tip[2]).toContain('9 秒前')
    expect(tip.join('\n')).not.toContain('a.ts')
  })

  it('编排里的智能体：跑着写任务，结束写结果', () => {
    expect(runActivity({ state: 'running', prompt: '查超时', result: '' })?.text).toBe('任务：查超时')
    expect(runActivity({ state: 'completed', prompt: '查超时', result: '找到了。原因是…' })?.text).toBe(
      '完成：找到了。',
    )
    expect(runActivity({ state: 'failed', prompt: '', result: 'API 报错' })?.kind).toBe('failed')
  })
})
