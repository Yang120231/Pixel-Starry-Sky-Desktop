import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { agentFileCount, filesByAgent, roundChangedFiles, toBlocks, type Block } from './changeBlocks'

const user = (id: string): Item => ({ kind: 'user', id, text: id, createdAt: 0 }) as Item
const reply = (id: string): Item => ({ kind: 'assistant', id, text: id, status: 'completed' }) as Item
const stats = (id: string): Item => ({ kind: 'turn_stats', id, usage: { models: {} } }) as unknown as Item
const edit = (id: string, path: string, agent?: { name: string; call?: string }, added = 1): Item =>
  ({
    kind: 'file_change',
    id,
    status: 'completed',
    changes: [{ path, kind: 'update', added, removed: 0 }],
    ...(agent ? { subagent: agent.name, ...(agent.call ? { subagentCall: agent.call } : {}) } : {}),
  }) as Item

const cards = (blocks: Block[]) => blocks.filter(b => b.type === 'changes')
const kinds = (blocks: Block[]) =>
  blocks.map(b => (b.type === 'item' ? b.item.kind : b.type === 'changes' ? `changes(${b.data.files.length})` : b.type))

describe('一轮一张改动卡片（GitHub #40）', () => {
  // 一轮里主智能体改了一个文件；之后两个后台子智能体先后跑完，各唤醒主智能体一次（各有一行统计）
  const C1 = { name: 'C1', call: 'toolu_c1' }
  const C2 = { name: 'C2', call: 'toolu_c2' }
  const items = [
    user('u1'),
    edit('e1', 'src/main.ts'),
    reply('r1'),
    stats('s1'),
    edit('e2', 'src/a.ts', C1),
    edit('e3', 'src/b.ts', C1),
    reply('r2'),
    stats('s2'),
    edit('e4', 'src/c.ts', C2),
    edit('e5', 'src/a.ts', C2),
    reply('r3'),
    stats('s3'),
  ]

  it('多次唤醒只出一张卡片，在最后一个结束点（最后一行统计之前），key 唯一', () => {
    const blocks = toBlocks(items, false, new Map())
    const found = cards(blocks)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ key: 'changes-u1', turnKey: 'u1' })
    const order = kinds(blocks)
    expect(order.indexOf('changes(4)')).toBe(order.lastIndexOf('turn_stats') - 1)
    // 合计按路径合并：a.ts 被两个子智能体改过，只算一个文件
    expect(found[0].type === 'changes' && found[0].data.files.map(f => f.dir + f.name)).toEqual([
      'src/main.ts',
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ])
  })

  it('运行中：最后一个结束点之后正在跑的改动不算进卡片，卡片停在上一个结束点', () => {
    const running = [...items.slice(0, 8), edit('e4', 'src/c.ts', C2)]
    const blocks = toBlocks(running, true, new Map())
    const found = cards(blocks)
    expect(found).toHaveLength(1)
    expect(found[0].type === 'changes' && found[0].data.files).toHaveLength(3)
  })

  it('空闲时最后一行统计之后又来了改动（后台子智能体）：卡片挪到最后并带上', () => {
    const idle = [...items.slice(0, 8), edit('e4', 'src/c.ts', C2)]
    const blocks = toBlocks(idle, false, new Map())
    expect(cards(blocks)).toHaveLength(1)
    expect(blocks.at(-1)).toMatchObject({ type: 'changes' })
    expect(blocks.at(-1)?.type === 'changes' && blocks.at(-1)).toMatchObject({ data: { files: { length: 4 } } })
  })

  it('不同轮各一张；没有统计行就结束的一轮（中断）卡片放在下一条用户消息之前', () => {
    const two = [user('u1'), edit('e1', 'a.ts'), user('u2'), edit('e2', 'b.ts'), stats('s2')]
    const blocks = toBlocks(two, false, new Map())
    expect(cards(blocks).map(b => b.type === 'changes' && b.key)).toEqual(['changes-u1', 'changes-u2'])
    expect(kinds(blocks).slice(0, 4)).toEqual(['user', 'process', 'changes(1)', 'user'])
  })

  it('断线重连自动发的「继续」接着原来那一轮：重连前后只有一张卡片，按原消息找快照', () => {
    const resumed = { kind: 'user', id: 'u1-reconnect-1', text: '继续', createdAt: 0, reconnect: 1 } as Item
    const flow = [user('u1'), edit('e1', 'a.ts'), stats('s1'), resumed, edit('e2', 'b.ts'), reply('r2'), stats('s2')]
    const blocks = toBlocks(flow, false, new Map())
    const found = cards(blocks)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ key: 'changes-u1', turnKey: 'u1', data: { files: { length: 2 } } })
    // 卡片在最后一行统计之前；「继续」照样显示在对话里
    const order = kinds(blocks)
    expect(order.indexOf('changes(2)')).toBe(order.lastIndexOf('turn_stats') - 1)
    expect(blocks.some(b => b.type === 'item' && b.item.id === 'u1-reconnect-1')).toBe(true)
  })

  it('断开的那段没有统计行、「继续」还在跑：断开前的改动卡片照样显示在「继续」之前，结束后挪到最后', () => {
    const resumed = { kind: 'user', id: 'u1-reconnect-1', text: '继续', createdAt: 0, reconnect: 1 } as Item
    const running = toBlocks([user('u1'), edit('e1', 'a.ts'), resumed, edit('e2', 'b.ts')], true, new Map())
    expect(kinds(running)).toEqual(['user', 'process', 'changes(1)', 'user', 'process'])
    expect(cards(running)[0]).toMatchObject({ turnKey: 'u1' })
    const done = toBlocks([user('u1'), edit('e1', 'a.ts'), resumed, edit('e2', 'b.ts'), stats('s2')], false, new Map())
    expect(kinds(done)).toEqual(['user', 'process', 'user', 'process', 'changes(2)', 'turn_stats'])
  })

  it('条目没变时复用缓存的卡片数据（memo 能跳过）', () => {
    const cache = new Map()
    const a = cards(toBlocks(items, false, cache))[0]
    const b = cards(toBlocks(items, false, cache))[0]
    expect(a.type === 'changes' && b.type === 'changes' && a.data === b.data).toBe(true)
  })
})

describe('按子智能体分组', () => {
  it('主智能体在前，子智能体按第一次改文件的顺序；同一个子智能体按调用 id 归组，旧条目按名字', () => {
    const data = roundChangedFiles([
      edit('e1', 'x.ts', { name: 'B', call: 'b' }) as never,
      edit('e2', 'm.ts') as never,
      edit('e3', 'y.ts', { name: 'A' }) as never,
      edit('e4', 'z.ts', { name: 'B', call: 'b' }, 5) as never,
    ])
    expect(data?.groups?.map(g => [g.label, g.files.length, g.added])).toEqual([
      [null, 1, 1],
      ['B', 2, 6],
      ['A', 1, 1],
    ])
    expect(data?.files).toHaveLength(4)
  })

  it('全是主智能体改的：不分组', () => {
    expect(roundChangedFiles([edit('e1', 'a.ts') as never])?.groups).toBeUndefined()
  })

  it('智能体追踪里每个子智能体改了几个文件：按调用 id，对不上按名字；按路径去重', () => {
    const counts = filesByAgent([
      edit('e1', 'a.ts', { name: 'C1', call: 'toolu_c1' }),
      edit('e2', 'a.ts', { name: 'C1', call: 'toolu_c1' }),
      edit('e3', 'b.ts', { name: 'C1', call: 'toolu_c1' }),
      edit('e4', 'c.ts', { name: 'Old' }),
      edit('e5', 'm.ts'),
    ])
    expect(agentFileCount(counts, 'toolu_c1', 'C1')).toBe(2)
    expect(agentFileCount(counts, 'toolu_old', 'Old')).toBe(1)
    expect(agentFileCount(counts, null, 'Nobody')).toBe(0)
  })
})

describe('子智能体显示成小框（docs/ui/subagent-box.md）', () => {
  const agent = (id: string): Item =>
    ({ kind: 'tool', id, tool: 'task', name: 'Agent', title: id, output: '', status: 'completed' }) as Item
  const cmd = (id: string, sub?: boolean): Item =>
    ({
      kind: 'command',
      id,
      command: id,
      description: null,
      output: '',
      exitCode: 0,
      status: 'completed',
      ...(sub ? { subagent: 'C1', subagentCall: 'ag1' } : {}),
    }) as Item
  const C1 = { name: 'C1', call: 'ag1' }
  const items = [
    user('u1'),
    cmd('c1'),
    agent('ag1'),
    cmd('sc1', true),
    edit('e1', 'src/a.ts', C1),
    edit('e2', 'src/main.ts'),
    reply('r1'),
    stats('s1'),
  ]
  const box = { subagents: 'box' } as const
  const shape = (blocks: Block[]) =>
    blocks.map(b =>
      b.type === 'process'
        ? b.items.map(i => i.id)
        : b.type === 'tools'
          ? b.items.map(i => i.id)
          : b.type === 'item'
            ? b.item.id
            : b.type,
    )

  it('box：派发单独成块，执行块在它前后断开，子智能体的条目不在对话流里', () => {
    expect(shape(toBlocks(items, false, new Map(), box))).toEqual(['u1', ['c1'], 'ag1', ['e2'], 'r1', 'changes', 's1'])
  })

  it('box：改动卡片不变，子智能体改的文件照旧在卡片里按来源分组', () => {
    const inline = cards(toBlocks(items, false, new Map()))[0]
    const boxed = cards(toBlocks(items, false, new Map(), box))[0]
    expect(boxed).toEqual(inline)
    expect(boxed.type === 'changes' && boxed.data.groups?.map(g => g.key)).toEqual(['main', 'ag1'])
  })

  it('box：运行中最后一个结束点之后藏起来的改动同样不算进卡片', () => {
    const running = [...items.slice(0, 8), edit('e3', 'src/b.ts', C1)]
    expect(cards(toBlocks(running, true, new Map(), box))).toEqual(cards(toBlocks(running, true, new Map())))
  })

  it('inline：和不传选项完全一样，派发留在执行块里', () => {
    const plain = toBlocks(items, false, new Map())
    expect(toBlocks(items, false, new Map(), { subagents: 'inline' })).toEqual(plain)
    expect(shape(plain)).toEqual(['u1', ['c1', 'ag1', 'sc1', 'e1', 'e2'], 'r1', 'changes', 's1'])
  })
})
