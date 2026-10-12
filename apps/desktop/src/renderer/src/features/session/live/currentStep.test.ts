// 运行中突出「现在在干什么」（docs/ui/conversation-concise.md §7）
import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { clockText, currentStep, stepText, waitingFor } from './currentStep'

type Status = 'completed' | 'running' | 'failed'
const run = (id: string, status: Status = 'completed', description: string | null = null): Item => ({
  kind: 'command',
  id,
  command: 'pnpm test\n--watch=false',
  description,
  output: '',
  exitCode: status === 'running' ? null : 0,
  status,
})
const tool = (id: string, kind: 'read' | 'search' | 'task' | 'other', status: Status = 'completed'): Item => ({
  kind: 'tool',
  id,
  tool: kind,
  name: kind === 'other' ? 'Skill' : 'Read',
  title: kind === 'task' ? '审查代码' : 'src/a.ts',
  output: '',
  status,
})
const edit = (id: string, paths: string[], status: Status = 'completed', add = false): Item => ({
  kind: 'file_change',
  id,
  changes: paths.map(path => ({ path, kind: add ? 'add' : 'update', diff: '', added: 1, removed: 0 })),
  status,
})
const say = (id: string, text = id, status: 'completed' | 'running' = 'completed'): Item => ({
  kind: 'assistant',
  id,
  text,
  status,
})
const think = (id: string, status: 'completed' | 'running' = 'completed'): Item => ({
  kind: 'reasoning',
  id,
  text: '',
  status,
})
const user = (id: string): Item => ({ kind: 'user', id, text: id, createdAt: 0 })
const info = (id: string): Item => ({ kind: 'notice', id, level: 'info', text: id })

describe('正在进行的一步', () => {
  it('取最后开始的那个还在跑的；并行的数出另外几个；都结束了为 null', () => {
    expect(currentStep([run('c1'), run('c2', 'running')])).toMatchObject({ item: { id: 'c2' }, more: 0 })
    const parallel = currentStep([tool('a1', 'task', 'running'), tool('a2', 'task', 'running'), think('r', 'running')])
    expect(parallel).toMatchObject({ item: { id: 'r' }, more: 2 })
    expect(currentStep([run('c1'), say('a')])).toBeNull()
    expect(currentStep([])).toBeNull()
  })

  it('每种步骤怎么写', () => {
    expect(stepText(run('c', 'running') as never)).toBe('运行 pnpm test')
    expect(stepText(run('c', 'running', '跑单元测试') as never)).toBe('跑单元测试')
    expect(stepText(edit('f', ['src/session/Composer.tsx'], 'running') as never)).toBe('修改 Composer.tsx')
    expect(stepText(edit('f', ['src\\new.ts'], 'running', true) as never)).toBe('新建 new.ts')
    expect(stepText(edit('f', ['a.ts', 'b.ts'], 'running') as never)).toBe('修改 2 个文件')
    expect(stepText(tool('t', 'read', 'running') as never)).toBe('读取 src/a.ts')
    expect(stepText(tool('t', 'task', 'running') as never)).toBe('子智能体：审查代码')
    expect(stepText(tool('t', 'other', 'running') as never)).toBe('Skill src/a.ts')
    expect(stepText(think('r', 'running') as never)).toBe('思考中')
  })
})

describe('两步之间在等什么', () => {
  it('工具刚结束：看结果；一段话说完：准备下一步；刚发消息或刚想完：思考', () => {
    expect(waitingFor([user('u'), run('c1')])).toBe('result')
    expect(waitingFor([user('u'), run('c1', 'failed')])).toBe('result')
    expect(waitingFor([user('u'), run('c1'), say('a')])).toBe('next')
    expect(waitingFor([user('u')])).toBe('thinking')
    expect(waitingFor([user('u'), think('r')])).toBe('thinking')
    expect(waitingFor([])).toBe('thinking')
  })

  it('信息提示、空白文字不算一步，接着往前看', () => {
    expect(waitingFor([user('u'), edit('f', ['a.ts']), info('i'), say('b', '\n\n')])).toBe('result')
  })
})

describe('用时', () => {
  it('一分钟内写整秒，再长交给 formatDuration', () => {
    expect(clockText(3400, () => 'long')).toBe('3s')
    expect(clockText(59_999, () => 'long')).toBe('59s')
    expect(clockText(65_000, ms => `long:${ms}`)).toBe('long:65000')
  })
})
