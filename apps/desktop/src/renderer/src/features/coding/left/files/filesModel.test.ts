import { describe, expect, it } from 'vitest'
import type { FileHit } from '@/features/search/fileSearch'
import { demoStatuses, dirHasChanges, filterHits, groupHits, kindTone, sortTurnFiles } from './filesModel'

const ref = { projectId: 'p' }
const hit = (path: string, line: number | null): FileHit => ({
  key: `${path}:${line}`,
  ref,
  path,
  line,
  column: line === null ? null : 1,
  text: '',
})
const change = (path: string, code: string) => ({ path, origPath: null, code, local: path, submodule: false }) as never

describe('sortTurnFiles', () => {
  it('新增在前，其余按路径', () => {
    const out = sortTurnFiles([
      { path: 'b.ts', kind: 'update' as const },
      { path: 'z.ts', kind: 'add' as const },
      { path: 'a.ts', kind: 'delete' as const },
      { path: 'c.ts', kind: 'add' as const },
    ])
    expect(out.map(f => f.path)).toEqual(['c.ts', 'z.ts', 'a.ts', 'b.ts'])
  })
})

describe('kindTone', () => {
  it('按类型着色', () => {
    expect(kindTone('add')).toBe('text-success')
    expect(kindTone('update')).toBe('text-warn')
    expect(kindTone('delete')).toBe('text-danger')
  })
})

describe('demoStatuses', () => {
  it('换算并按优先级合并', () => {
    const s = demoStatuses({
      staged: [change('a.ts', 'M'), change('n.ts', 'A')],
      unstaged: [change('a.ts', 'M'), change('n.ts', 'M'), change('d.ts', 'D'), change('r.ts', 'R')],
      untracked: [change('u.md', '?')],
      conflicted: [change('c.ts', 'U')],
    })
    expect(s).toEqual({ 'a.ts': 'M', 'n.ts': 'A', 'd.ts': 'D', 'r.ts': 'M', 'u.md': '?', 'c.ts': '!' })
  })
})

describe('dirHasChanges', () => {
  it('看目录下面有没有改动', () => {
    const s = { 'src/a/b.ts': 'M' }
    expect(dirHasChanges(s, 'src')).toBe(true)
    expect(dirHasChanges(s, 'src/a')).toBe(true)
    expect(dirHasChanges(s, 'src/ab')).toBe(false)
    expect(dirHasChanges(s, 'docs')).toBe(false)
  })
})

describe('filterHits / groupHits', () => {
  const hits = [hit('a/x.ts', null), hit('a/x.ts', 3), hit('b.ts', 7), hit('a/x.ts', 9), hit('c.ts', null)]
  it('按模式过滤', () => {
    expect(filterHits(hits, 'name').map(h => h.path)).toEqual(['a/x.ts', 'c.ts'])
    expect(filterHits(hits, 'content')).toHaveLength(3)
  })
  it('按文件分组并保持顺序', () => {
    const g = groupHits(filterHits(hits, 'content'))
    expect(g.map(x => x.path)).toEqual(['a/x.ts', 'b.ts'])
    expect(g[0]).toMatchObject({ name: 'x.ts', dir: 'a' })
    expect(g[0].hits).toHaveLength(2)
    expect(g[1].dir).toBe('')
  })
})
