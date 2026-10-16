import { describe, expect, it } from 'vitest'
import { describeTopic } from './sessionStatusText'
import type { StatusKind } from './sessionStatusModel'

const KINDS: StatusKind[] = [
  'approve',
  'question',
  'auth',
  'balance',
  'route',
  'busy',
  'failed',
  'folder',
  'offline',
  'paused',
  'running',
  'unread',
  'pr-conflict',
  'pr',
]

describe('describeTopic', () => {
  // 以前 PR 落到出错的分支，拼出不存在的文案键，悬停 PR 图标整个界面崩掉
  it('每种状态都不抛错，问题类有标题', () => {
    for (const kind of KINDS) {
      const text = describeTopic(kind, { card: null, record: undefined, error: '' })
      if (kind === 'pr' || kind === 'pr-conflict' || kind === 'running' || kind === 'unread')
        expect(text.title).toBe('')
      else expect(text.title, kind).not.toBe('')
    }
  })
})
