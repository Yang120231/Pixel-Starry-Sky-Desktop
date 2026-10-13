import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { activityKey, activityText } from './activityModel'

const cmd = (id: string, status: 'running' | 'completed', command = 'npm run typecheck'): Item =>
  ({ id, kind: 'command', status, command, output: '', exitCode: null }) as unknown as Item
const assistant = (id: string, text: string, status: 'running' | 'completed' = 'completed'): Item =>
  ({ id, kind: 'assistant', text, status }) as unknown as Item

describe('activityText', () => {
  it('没在运行时没有活动', () => {
    expect(activityText([cmd('c1', 'running')], false, 0)).toBeNull()
    expect(activityKey([cmd('c1', 'running')], false)).toBeNull()
  })
  it('有在跑的一步时写这一步并带条目 id', () => {
    const a = activityText([assistant('a1', 'hi'), cmd('c1', 'running')], true, 0)
    expect(a?.itemId).toBe('c1')
    expect(a?.text).toContain('npm run typecheck')
    expect(a?.key).toBe('step:c1')
  })
  it('一步超过 3 秒才带用时', () => {
    const items = [cmd('c1', 'running')]
    expect(activityText(items, true, 2000)?.text).not.toContain('·')
    expect(activityText(items, true, 4000)?.text).toContain('· ')
  })
  it('并行的步骤写还有几项', () => {
    const a = activityText([cmd('c1', 'running'), cmd('c2', 'running')], true, 0)
    expect(a?.itemId).toBe('c2')
    expect(a?.text).toContain('·')
  })
  it('两步之间写在等什么，超过 5 秒带已等的时间，itemId 为 null', () => {
    const items = [cmd('c1', 'completed')]
    const short = activityText(items, true, 1000)
    expect(short?.itemId).toBeNull()
    expect(short?.text).not.toContain('·')
    expect(activityText(items, true, 6000)?.text).toContain('·')
  })
  it('正在输出文字、等你批准时没有活动', () => {
    expect(activityText([assistant('a1', 'x', 'running')], true, 0)).toBeNull()
    expect(activityText([cmd('c1', 'completed')], true, 0, false)).toBeNull()
  })
})
