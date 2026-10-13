import { describe, expect, it } from 'vitest'
import { snapshotStats } from './snapshotStats'

const snap = (items: unknown[]) => ({ items }) as never

describe('快照规模统计', () => {
  it('文字和图片分开数，附件数组里的对象也算', () => {
    const stats = snapshotStats({
      a: snap([
        { id: 'x1', text: 'hello' },
        { id: 'x2', images: [{ name: 'a.png', dataBase64: 'AAAAAAAA' }], attachments: [{ path: 'p' }, null] },
      ]),
      b: snap([]),
    })
    expect(stats).toEqual({ snapshots: 2, items: 2, textChars: 2 + 5 + 2 + 5 + 1, imageChars: 8 })
  })

  it('没有快照全是 0', () => {
    expect(snapshotStats({})).toEqual({ snapshots: 0, items: 0, textChars: 0, imageChars: 0 })
  })
})
