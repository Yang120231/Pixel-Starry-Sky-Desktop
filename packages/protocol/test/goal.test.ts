import { describe, expect, it } from 'vitest'
import { parseGoalCommand } from '../src'

describe('parseGoalCommand', () => {
  it('看 / 暂停 / 继续 / 清除 / 设目标；不是 /goal 开头的不算', () => {
    expect(parseGoalCommand('/goal')).toEqual({ kind: 'get' })
    expect(parseGoalCommand('  /goal  ')).toEqual({ kind: 'get' })
    expect(parseGoalCommand('/goal pause')).toEqual({ kind: 'pause' })
    expect(parseGoalCommand('/goal RESUME')).toEqual({ kind: 'resume' })
    expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' })
    expect(parseGoalCommand('/goal 把测试修好\n全部通过为止')).toEqual({
      kind: 'set',
      objective: '把测试修好\n全部通过为止',
    })
    expect(parseGoalCommand('/goal pause the build')).toEqual({ kind: 'set', objective: 'pause the build' })
    expect(parseGoalCommand('/goals')).toBeNull()
    expect(parseGoalCommand('请 /goal 一下')).toBeNull()
    expect(parseGoalCommand('/compact')).toBeNull()
  })
})
