import { describe, expect, it } from 'vitest'
import type { ArtifactTurn, FileChange } from '@pixelsky/protocol'
import { artifactDiffs, formatBytes, groupBySession, splitArtifactPath } from './artifactsModel'

const turn = (sessionId: string, at: number): ArtifactTurn => ({
  sessionId,
  title: sessionId,
  engine: 'claude',
  archived: false,
  userItemId: 'u' + at,
  prompt: '',
  at,
  files: [],
})

describe('产物面板显示规则', () => {
  it('变更按会话分组：会话按最近一轮倒序，组内各轮也倒序', () => {
    const groups = groupBySession([turn('a', 1), turn('b', 5), turn('a', 9), turn('b', 3)])
    expect(groups.map(g => [g.sessionId, g.turns.map(t => t.at)])).toEqual([
      ['a', [9, 1]],
      ['b', [5, 3]],
    ])
  })
  it('文件大小与路径拆分（兼容 Windows 分隔符）', () => {
    expect([
      formatBytes(null),
      formatBytes(512),
      formatBytes(2048),
      formatBytes(1536),
      formatBytes(3 * 1024 * 1024),
    ]).toEqual(['', '512 B', '2 KB', '1.5 KB', '3 MB'])
    expect(splitArtifactPath('C:\\Users\\x\\报告.md')).toEqual({ name: '报告.md', dir: 'C:/Users/x' })
    expect(splitArtifactPath('a.md')).toEqual({ name: 'a.md', dir: '' })
  })
  it('展开文件：取这一轮每条改动记录里这个文件的 diff，相对 / 绝对路径都认，取不到的跳过', () => {
    const file = { path: 'config/app.yml', absolute: 'D:\\w\\config\\app.yml' }
    const c = (path: string, diff: string): FileChange => ({ path, kind: 'update', diff, added: 1, removed: 0 })
    const diffs = artifactDiffs(
      file,
      [
        [c('config/app.yml', '+a'), c('other.ts', '+x')],
        null,
        [c('D:/W/config/APP.yml', '+b'), c('config/app.yml', ''), c('config\\app.yml', '+c')],
      ],
      true,
    )
    expect(diffs).toEqual(['+a', '+b', '+c'])
    expect(artifactDiffs(file, [[c('D:/W/config/APP.yml', '+b')]], false)).toEqual([])
  })
})
