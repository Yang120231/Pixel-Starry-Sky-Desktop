// 截过的长输出按需取完整的一条：同时只取一次、最近 16 条、截过的那条换了内容重新取、取不到退回截过的
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cutItem, type Item } from '@pixelsky/protocol'
import { ImageSessionContext } from '../attachments/imageSource'
import { cachedItem, fullItem, useItemBody } from './itemBody'

vi.mock('@/data', () => ({ isDemo: false }))
const item = vi.fn<(sessionId: string, itemId: string) => Promise<Item | null>>()
;(globalThis as { window?: unknown }).window = { pixelsky: { engine: { item } } }

const command = (id: string, output: string): Item => ({
  kind: 'command',
  id,
  command: 'cat big',
  description: null,
  output,
  exitCode: 0,
  status: 'completed',
})
const long = (tag: string): string => tag + 'x'.repeat(10_000) + tag
const answer = (output: string) => async (_s: string, id: string) => command(id, output)
const outputOf = (it: Item): string => (it.kind === 'command' ? it.output : '')

beforeEach(() => item.mockReset())

describe('fullItem', () => {
  it('没截过的原样返回，不取', async () => {
    const plain = command('p', 'short')
    expect(await fullItem(plain, 's1')).toBe(plain)
    expect(item).not.toHaveBeenCalled()
  })

  it('同一条同时只取一次，补回完整输出、去掉 cut 标记', async () => {
    const cut = cutItem(command('c1', long('a')))
    item.mockImplementation(answer(long('a')))
    const [a, b] = await Promise.all([fullItem(cut, 's1'), fullItem(cut, 's1')])
    expect(item).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(outputOf(a)).toBe(long('a'))
    expect(a.cut).toBeUndefined()
    expect(a.cutChars).toBeUndefined()
    expect(cachedItem(cut, 's1')).toBe(a)
  })

  it('最近 16 条：多出来的最早那条要重新取', async () => {
    item.mockImplementation(answer(long('b')))
    const cuts = Array.from({ length: 17 }, (_, i) => cutItem(command(`l${i}`, long('b'))))
    for (const cut of cuts) await fullItem(cut, 's2')
    expect(item).toHaveBeenCalledTimes(17)
    expect(cachedItem(cuts[0], 's2')).toBeNull()
    expect(cachedItem(cuts[1], 's2')).not.toBeNull()
    await fullItem(cuts[0], 's2')
    expect(item).toHaveBeenCalledTimes(18)
  })

  it('截过的那条换了内容重新取；内容一样的新对象算同一条', async () => {
    item.mockImplementation(answer(long('c')))
    const cut = cutItem(command('o1', long('c')))
    const first = await fullItem(cut, 's3')
    expect(await fullItem({ ...cut }, 's3')).toBe(first)
    expect(item).toHaveBeenCalledTimes(1)
    item.mockImplementation(answer(long('d') + 'more'))
    const second = await fullItem(cutItem(command('o1', long('d') + 'more')), 's3')
    expect(item).toHaveBeenCalledTimes(2)
    expect(outputOf(second)).toBe(long('d') + 'more')
  })

  it('取不到（出错、没有这一条、主进程也只有截过的）退回截过的那条，不记住', async () => {
    const cut = cutItem(command('f1', long('e')))
    item.mockRejectedValueOnce(new Error('gone'))
    expect(await fullItem(cut, 's4')).toBe(cut)
    item.mockResolvedValueOnce(null)
    expect(await fullItem(cut, 's4')).toBe(cut)
    item.mockResolvedValueOnce(cut)
    expect(await fullItem(cut, 's4')).toBe(cut)
    expect(cachedItem(cut, 's4')).toBeNull()
    expect(await fullItem(cut, null)).toBe(cut)
    expect(item).toHaveBeenCalledTimes(3)
  })
})

describe('useItemBody', () => {
  function Body({ of, want }: { of: Item; want: boolean }) {
    return <pre>{outputOf(useItemBody(of, want)).length}</pre>
  }
  const render = (of: Item, want: boolean): string =>
    renderToStaticMarkup(
      <ImageSessionContext.Provider value="s5">
        <Body of={of} want={want} />
      </ImageSessionContext.Provider>,
    )

  it('取过的直接用（行重新挂上时不先闪成头尾）；不要时用截过的', async () => {
    item.mockImplementation(answer(long('g')))
    const cut = cutItem(command('h1', long('g')))
    expect(render(cut, true)).toBe(`<pre>${outputOf(cut).length}</pre>`)
    await fullItem(cut, 's5')
    expect(render(cut, true)).toBe(`<pre>${long('g').length}</pre>`)
    expect(render(cut, false)).toBe(`<pre>${outputOf(cut).length}</pre>`)
  })
})
