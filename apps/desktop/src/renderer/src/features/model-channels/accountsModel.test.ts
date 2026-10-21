import { describe, expect, it } from 'vitest'
import type { EngineAccount } from '@pixelsky/protocol'
import { canRemove, duplicateIds, removeNext } from './accountsModel'

const row = (id: string, email: string | null, status: EngineAccount['status'] = 'ok'): EngineAccount => ({
  id,
  email,
  plan: null,
  label: null,
  addedAt: 0,
  status,
})

describe('删除账号（只在像素星空里生效）', () => {
  it('列表至少两项才能删；原来的账号要还有别的可用账号', () => {
    expect(canRemove({ accounts: [row('default', 'me@x.com')] }, 'default')).toBe(false)
    const two = { accounts: [row('default', 'me@x.com'), row('a_111111111111', 'work@x.com')] }
    expect(canRemove(two, 'default')).toBe(true)
    expect(canRemove(two, 'a_111111111111')).toBe(true)
    const expired = { accounts: [row('default', 'me@x.com'), row('a_111111111111', 'work@x.com', 'expired')] }
    expect(canRemove(expired, 'default')).toBe(false)
    expect(canRemove(expired, 'a_111111111111')).toBe(true)
  })

  it('删掉当前账号后换到列表里第一个没失效的别的账号；没有为 null（回到原来的账号）', () => {
    const list = {
      accounts: [row('default', 'me@x.com', 'expired'), row('a_1', 'a@x.com'), row('a_2', 'b@x.com')],
    }
    expect(removeNext(list, 'a_1')?.id).toBe('a_2')
    expect(removeNext(list, 'a_2')?.id).toBe('a_1')
    expect(removeNext({ accounts: [row('a_1', 'a@x.com')] }, 'a_1')).toBeNull()
  })

  it('同一个邮箱（不分大小写）出现两次的都标重复；没有邮箱的不算', () => {
    const list = {
      accounts: [
        row('default', 'Me@X.com'),
        row('a_1', 'me@x.com'),
        row('a_2', null),
        row('a_3', null),
        row('a_4', 'o@x.com'),
      ],
    }
    expect([...duplicateIds(list)].sort()).toEqual(['a_1', 'default'])
  })
})
