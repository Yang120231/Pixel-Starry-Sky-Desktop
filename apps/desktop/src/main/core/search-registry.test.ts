import { describe, expect, it } from 'vitest'
import { SearchRegistry } from './search-registry'

const cancelled = () => 'cancelled'
/** 一直等到被中止的查询 */
const hanging = (signal: AbortSignal) =>
  new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))

describe('SearchRegistry', () => {
  it('aborts the older query of the same owner', async () => {
    const registry = new SearchRegistry()
    const first = registry.begin('w1', 1, hanging, cancelled)
    const second = registry.begin('w1', 2, async () => 'done', cancelled)
    expect(await first).toBe('cancelled')
    expect(await second).toBe('done')
  })

  it('returns cancelled for a request that arrives after a newer one', async () => {
    const registry = new SearchRegistry()
    const newer = registry.begin('w1', 5, hanging, cancelled)
    let ran = false
    expect(
      await registry.begin(
        'w1',
        4,
        async () => {
          ran = true
          return 'old'
        },
        cancelled,
      ),
    ).toBe('cancelled')
    expect(ran).toBe(false)
    registry.release('w1')
    expect(await newer).toBe('cancelled')
  })

  it('keeps owners apart and cancels by request id only', async () => {
    const registry = new SearchRegistry()
    const a = registry.begin('w1', 1, hanging, cancelled)
    const b = registry.begin('w2', 1, async () => 'b', cancelled)
    expect(await b).toBe('b')
    registry.cancel('w1', 2)
    registry.cancel('w2', 1)
    registry.cancel('w1', 1)
    expect(await a).toBe('cancelled')
  })

  it('passes real failures through', async () => {
    const registry = new SearchRegistry()
    await expect(
      registry.begin(
        'w1',
        1,
        async () => {
          throw new Error('broken')
        },
        cancelled,
      ),
    ).rejects.toThrow('broken')
    // 失败后桶已清空，同一个请求号可以再来
    expect(await registry.begin('w1', 1, async () => 'again', cancelled)).toBe('again')
  })
})
