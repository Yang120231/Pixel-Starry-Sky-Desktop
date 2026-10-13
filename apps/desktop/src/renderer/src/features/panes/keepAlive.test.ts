import { describe, expect, it, vi } from 'vitest'
import { keepMounted, isSessionTab, pruneRecency } from './keepAlive'
import { fileTab, type Leaf } from './tree'

// keepAlive 订阅引擎 store；这里只测纯函数，不加载它
vi.mock('@/features/engine/store', () => ({ useEngineState: () => '' }))

const leaf = (id: string, tabs: string[], active: string | null): Leaf => ({ type: 'leaf', id, tabs, active })
const opts = (limit: number, pinned: string[] = []) => ({
  limit,
  isSession: isSessionTab,
  pinned: (tab: string) => pinned.includes(tab),
})
const recent = (...tabs: string[]) => new Map(tabs.map((t, i) => [t, i + 1]))

describe('pruneRecency', () => {
  it('关掉的标签从记录里去掉，还在的（含别的窗格）保留', () => {
    const r = recent('a', 'b', 'c')
    pruneRecency(r, [leaf('L1', ['a'], 'a'), leaf('L2', ['c'], 'c')])
    expect([...r.keys()]).toEqual(['a', 'c'])
  })
})

describe('标签保活', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e']

  it('当前标签 + 最近用过的 2 个对话标签', () => {
    const keep = keepMounted([leaf('L', tabs, 'e')], recent('a', 'b', 'c', 'd', 'e'), opts(2))
    expect([...keep].sort()).toEqual(['c', 'd', 'e'])
  })

  it('启动时没有用过记录，只挂当前标签', () => {
    expect([...keepMounted([leaf('L', tabs, 'b')], new Map(), opts(2))]).toEqual(['b'])
  })

  it('新对话和文件标签总在', () => {
    const file = fileTab({ projectId: 'p' }, 'x.ts')
    const t = ['a', 'new:1', file, 'b']
    expect([...keepMounted([leaf('L', t, 'a')], new Map(), opts(2))].sort()).toEqual(['a', file, 'new:1'].sort())
  })

  it('等你处理的不卸载也不占名额', () => {
    const keep = keepMounted([leaf('L', tabs, 'e')], recent('a', 'b', 'c', 'd', 'e'), opts(2, ['a', 'b']))
    expect([...keep].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    const few = keepMounted([leaf('L', tabs, 'e')], recent('a', 'b', 'c', 'd', 'e'), opts(1, ['a']))
    expect([...few].sort()).toEqual(['a', 'd', 'e'])
  })

  it('轻量模式（0）只留当前和等你处理的', () => {
    const keep = keepMounted([leaf('L', tabs, 'e')], recent('a', 'b', 'c', 'd', 'e'), opts(0, ['a']))
    expect([...keep].sort()).toEqual(['a', 'e'])
  })

  it('标签移到别的窗格后按新窗格算', () => {
    const rec = recent('a', 'b', 'c', 'd')
    const before = keepMounted([leaf('L', ['a', 'b', 'c'], 'c'), leaf('R', ['d'], 'd')], rec, opts(1))
    expect([...before].sort()).toEqual(['b', 'c', 'd'])
    // b 拖到右窗格：左窗格里最近的变成 a，右窗格的 d 是当前，b 排第二
    const after = keepMounted([leaf('L', ['a', 'c'], 'c'), leaf('R', ['d', 'b'], 'd')], rec, opts(1))
    expect([...after].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
