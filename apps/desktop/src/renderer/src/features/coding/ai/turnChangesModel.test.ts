import { describe, expect, it } from 'vitest'
import type { FileChange, Item } from '@pixelsky/protocol'
import { latestTurnChanges, relativePath } from './turnChangesModel'

type Status = Extract<Item, { kind: 'file_change' }>['status']
const user = (id: string, mode?: 'guidance'): Item => ({
  kind: 'user',
  id,
  text: id,
  createdAt: 0,
  ...(mode ? { mode } : {}),
})
const change = (
  path: string,
  kind: FileChange['kind'] = 'update',
  diff = '@@\n+a',
  added = 1,
  removed = 0,
): FileChange => ({ path, kind, diff, added, removed })
const edit = (id: string, changes: FileChange[], status: Status = 'completed'): Item => ({
  kind: 'file_change',
  id,
  changes,
  status,
})

describe('relativePath', () => {
  it('去掉项目根，统一斜杠', () => {
    expect(relativePath('D:\\work\\app', 'D:\\work\\app\\src\\a.ts', false)).toBe('src/a.ts')
    expect(relativePath('D:/work/app/', 'D:/work/app/src/a.ts', false)).toBe('src/a.ts')
  })
  it('区分大小写 / 不区分', () => {
    expect(relativePath('D:/Work/App', 'd:/work/app/src/a.ts', true)).toBe('src/a.ts')
    expect(relativePath('D:/Work/App', 'd:/work/app/src/a.ts', false)).toBe('d:/work/app/src/a.ts')
  })
  it('相对路径去掉开头的 ./，根目录之外的原样返回', () => {
    expect(relativePath('/r', './src/a.ts', false)).toBe('src/a.ts')
    expect(relativePath('/r', '/other/a.ts', false)).toBe('/other/a.ts')
    expect(relativePath('/r', '/rx/a.ts', false)).toBe('/rx/a.ts')
  })
})

describe('latestTurnChanges', () => {
  it('引导消息不分轮', () => {
    const items = [user('u1'), edit('e1', [change('a.ts')]), user('g', 'guidance'), edit('e2', [change('b.ts')])]
    const result = latestTurnChanges(items, false, '', false)!
    expect(result.turnKey).toBe('u1')
    expect(result.files.map(f => f.path)).toEqual(['a.ts', 'b.ts'])
  })
  it('断线重连自动发的「继续」不分轮：重连前后的改动都算这一轮', () => {
    const resumed: Item = { kind: 'user', id: 'u1-reconnect-1', text: '继续', createdAt: 0, reconnect: 1 }
    const items = [user('u1'), edit('e1', [change('a.ts')]), resumed, edit('e2', [change('b.ts')])]
    const result = latestTurnChanges(items, false, '', false)!
    expect(result.turnKey).toBe('u1')
    expect(result.files.map(f => f.path)).toEqual(['a.ts', 'b.ts'])
  })
  it('绝对路径和相对路径合并，diffs 按出现顺序', () => {
    const items = [
      user('u1'),
      edit('e1', [change('/r/src/a.ts', 'update', 'one', 2, 1)]),
      edit('e2', [change('src/a.ts', 'update', 'two', 3, 0)]),
    ]
    const result = latestTurnChanges(items, false, '/r', false)!
    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({
      path: 'src/a.ts',
      name: 'a.ts',
      dir: 'src/',
      added: 5,
      removed: 1,
      diffs: ['one', 'two'],
    })
    expect(result.added).toBe(5)
    expect(result.removed).toBe(1)
  })
  it('Windows 下大小写不敏感', () => {
    const items = [user('u1'), edit('e1', [change('D:\\W\\Src\\A.ts'), change('d:/w/src/a.ts')])]
    expect(latestTurnChanges(items, false, 'D:/W', true)!.files).toHaveLength(1)
    expect(latestTurnChanges(items, false, 'D:/W', false)!.files).toHaveLength(2)
  })
  it('只算已完成的，往前找有改动的一轮', () => {
    const items = [
      user('u1'),
      edit('e1', [change('a.ts')]),
      user('u2'),
      edit('e2', [change('b.ts')], 'running'),
      edit('e3', [change('c.ts')], 'failed'),
    ]
    const result = latestTurnChanges(items, true, '', false)!
    expect(result.turnKey).toBe('u1')
    expect(result.running).toBe(false)
  })
  it('最后一轮有改动时 running 照传入的值', () => {
    const items = [user('u1'), edit('e1', [change('a.ts')])]
    expect(latestTurnChanges(items, true, '', false)!.running).toBe(true)
    expect(latestTurnChanges(items, false, '', false)!.running).toBe(false)
  })
  it('add 再 update 记 add；最后是 delete 记 delete', () => {
    const items = [
      user('u1'),
      edit('e1', [change('n.ts', 'add'), change('o.ts', 'update'), change('d.ts', 'add')]),
      edit('e2', [change('n.ts', 'update'), change('d.ts', 'delete')]),
    ]
    const kinds = Object.fromEntries(latestTurnChanges(items, false, '', false)!.files.map(f => [f.path, f.kind]))
    expect(kinds).toEqual({ 'n.ts': 'add', 'o.ts': 'update', 'd.ts': 'delete' })
  })
  it('空 diff 不进 diffs，文件照样列出', () => {
    const items = [user('u1'), edit('e1', [change('a.bin', 'update', '', 0, 0)])]
    expect(latestTurnChanges(items, false, '', false)!.files[0].diffs).toEqual([])
  })
  it('第一条用户消息之前的改动记在 start；没有改动时 null', () => {
    expect(latestTurnChanges([edit('e1', [change('a.ts')])], false, '', false)!.turnKey).toBe('start')
    expect(latestTurnChanges([user('u1')], false, '', false)).toBeNull()
    expect(latestTurnChanges([], false, '', false)).toBeNull()
  })
})
