import { describe, expect, it } from 'vitest'
import type { ArtifactTurn } from '@pixelsky/protocol'
import { formatBytes, groupBySession, splitArtifactPath } from './artifactsModel'

const turn = (sessionId: string, at: number): ArtifactTurn => ({ sessionId, title: sessionId, engine: 'claude', archived: false, userItemId: 'u' + at, prompt: '', at, files: [] })

describe('产物面板显示规则', () => {
  it('变更按会话分组：会话按最近一轮倒序，组内各轮也倒序', () => {
    const groups = groupBySession([turn('a', 1), turn('b', 5), turn('a', 9), turn('b', 3)])
    expect(groups.map(g => [g.sessionId, g.turns.map(t => t.at)])).toEqual([['a', [9, 1]], ['b', [5, 3]]])
  })
  it('文件大小与路径拆分（兼容 Windows 分隔符）', () => {
    expect([formatBytes(null), formatBytes(512), formatBytes(2048), formatBytes(1536), formatBytes(3 * 1024 * 1024)]).toEqual(['', '512 B', '2 KB', '1.5 KB', '3 MB'])
    expect(splitArtifactPath('C:\\Users\\x\\报告.md')).toEqual({ name: '报告.md', dir: 'C:/Users/x' })
    expect(splitArtifactPath('a.md')).toEqual({ name: 'a.md', dir: '' })
  })
})
