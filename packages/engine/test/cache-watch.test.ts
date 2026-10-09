import { describe, expect, it } from 'vitest'
import type { RequestCacheUsage } from '@pixelsky/protocol'
import { CacheWatch } from '../src/cache-watch'

const request = (input: number, cacheRead: number, at = 1000, model = 'opus', cacheWrite = 0): RequestCacheUsage => ({ turnId: 'turn', messageId: `${at}`, model, input, cacheRead, cacheWrite, observedAt: at })

describe('连续请求的缓存识别', () => {
  it('首个请求建立基线，正常命中和恰好 50% 不提醒', () => {
    const watch = new CacheWatch()
    expect(watch.check(request(10000, 0), 'self')).toBeNull()
    expect(watch.check(request(2000, 8000, 2000), 'self')).toBeNull()
    expect(watch.check(request(5000, 5000, 3000), 'self')).toBeNull()
  })
  it('零命中和明显偏低均能识别，缓存写入计入全部输入', () => {
    const watch = new CacheWatch()
    watch.check(request(2000, 0, 1000, 'opus', 8000), 'self')
    expect(watch.check(request(10000, 2000, 2000), 'self')).toEqual({ input: 12000, previousInput: 10000 })
    expect(watch.check(request(14000, 0, 3000), 'self')).toEqual({ input: 14000, previousInput: 12000 })
  })
  it('短输入、输入缩短、长停顿不提醒', () => {
    const watch = new CacheWatch()
    watch.check(request(900, 0), 'self')
    expect(watch.check(request(10000, 0, 2000), 'self')).toBeNull()
    expect(watch.check(request(3000, 0, 3000), 'self')).toBeNull()
    expect(watch.check(request(4000, 0, 304000), 'self')).toBeNull()
    expect(watch.check(request(5000, 0, 305000), 'self')).not.toBeNull()
  })
  it('模型和线路/账号切换、压缩/重启重置后重新建立基线', () => {
    const watch = new CacheWatch()
    watch.check(request(10000, 0), 'self')
    expect(watch.check(request(10000, 0, 2000, 'sonnet'), 'self')).toBeNull()
    expect(watch.check(request(10000, 0, 3000, 'sonnet'), 'platform:7:user')).toBeNull()
    watch.reset()
    expect(watch.check(request(10000, 0, 4000, 'sonnet'), 'platform:7:user')).toBeNull()
  })
  it('无效数据和时钟倒退不形成错误比较', () => {
    const watch = new CacheWatch()
    watch.check(request(10000, 0), 'self')
    expect(watch.check(request(10000, NaN, 2000), 'self')).toBeNull()
    expect(watch.check(request(10000, 0, 3000), 'self')).toBeNull()
    expect(watch.check(request(10000, 0, 2500), 'self')).toBeNull()
  })
})
