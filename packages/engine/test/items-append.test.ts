// 对话记录写坏的最后一行不连带吃掉下一条（审计 2026-10-27 #11）
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { Store } from '../src/store'
import { makeTmp, removeTmp } from './helpers/tmp'

let dir: string
beforeEach(() => {
  dir = makeTmp('items-append')
})
afterEach(() => removeTmp(dir))

const user = (id: string): Item => ({ kind: 'user', id, text: id, createdAt: 1 }) as Item

describe('items.jsonl 追加', () => {
  it('上次写到一半断电（最后一行没有换行）：重开后追加的新条目照样读得出来', () => {
    new Store(dir).appendItem('s1', user('a'))
    appendFileSync(join(dir, 'sessions', 's1', 'items.jsonl'), '{"kind":"user","id":"tor')
    const store = new Store(dir)
    store.appendItem('s1', user('b'))
    store.appendItem('s1', user('c'))
    expect(store.loadItems('s1').map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
})
