import { describe, expect, it } from 'vitest'
import { cutItem, type Item } from '@pixelsky/protocol'
import {
  MAX_COMMANDS,
  MAX_OUTPUT_CHARS,
  aiCommandEntries,
  clipOutput,
  commandTone,
  entryOutput,
  summarizeAiCommands,
} from './aiCommandsModel'

type Cmd = Extract<Item, { kind: 'command' }>
const cmd = (id: string, patch: Partial<Cmd> = {}): Item => ({
  kind: 'command',
  id,
  command: 'npm test',
  description: null,
  output: '',
  exitCode: 0,
  status: 'completed',
  ...patch,
})

describe('aiCommandEntries', () => {
  it('只取 command 条目，保留顺序和子智能体名', () => {
    const items: Item[] = [
      { kind: 'assistant', id: 'a', text: 'hi', status: 'completed' },
      cmd('c1', { description: 'run tests' }),
      cmd('c2', { subagent: 'reviewer', status: 'running', exitCode: null }),
    ]
    const entries = aiCommandEntries(items)
    expect(entries.map(e => e.id)).toEqual(['c1', 'c2'])
    expect(entries[0].description).toBe('run tests')
    expect(entries[1].subagent).toBe('reviewer')
    expect(entries[0].subagent).toBeUndefined()
  })
  it('最多 200 条，留最近的', () => {
    const items = Array.from({ length: MAX_COMMANDS + 5 }, (_, i) => cmd('c' + i))
    const entries = aiCommandEntries(items)
    expect(entries).toHaveLength(MAX_COMMANDS)
    expect(entries[0].id).toBe('c5')
  })
  it('输出超过 40000 字时留末尾', () => {
    const output = 'a'.repeat(MAX_OUTPUT_CHARS) + 'END'
    const [entry] = aiCommandEntries([cmd('c', { output })])
    expect(entry.output).toHaveLength(MAX_OUTPUT_CHARS)
    expect(entry.output.endsWith('END')).toBe(true)
    expect(clipOutput('abc', 10)).toBe('abc')
  })
  it('快照里截过的输出带上那一条，取到完整的后留末尾', () => {
    const output = 'a'.repeat(MAX_OUTPUT_CHARS) + 'END'
    const cut = cutItem(cmd('c', { output }))
    const [entry, plain] = aiCommandEntries([cut, cmd('d')])
    expect(entry.item).toBe(cut)
    expect(plain.item.id).toBe('d')
    // 没取到（还是截过的那条）用头尾；取到了用完整的末尾
    expect(entryOutput(entry, cut)).toBe(entry.output)
    expect(entryOutput(entry, cmd('c', { output }))).toBe(clipOutput(output))
  })
})

describe('summarize / tone', () => {
  it('统计运行中和失败的', () => {
    const entries = aiCommandEntries([
      cmd('1'),
      cmd('2', { status: 'running', exitCode: null }),
      cmd('3', { status: 'failed', exitCode: 1 }),
      cmd('4', { exitCode: 2 }),
    ])
    expect(summarizeAiCommands(entries)).toEqual({ total: 4, running: 1, failed: 2 })
    expect(entries.map(commandTone)).toEqual(['done', 'running', 'failed', 'failed'])
  })
})
