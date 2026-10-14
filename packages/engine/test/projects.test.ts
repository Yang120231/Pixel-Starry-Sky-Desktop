// 项目列表的重命名与移除：只改显示名 / 列表，不碰磁盘上的文件夹
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { HostEvent } from '@pixelsky/protocol'
import { EngineHost } from '../src'

let root: string
let events: HostEvent[]
const makeHost = (): EngineHost =>
  new EngineHost({ dataDir: join(root, 'data'), emit: e => events.push(e), adapters: {} })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-projects-'))
  events = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('重命名只改显示名，去掉首尾空白，保存并广播，重启后保留', () => {
  const dir = mkdtempSync(join(root, 'proj-'))
  const host = makeHost()
  const project = host.addProject(dir)
  expect(project.name).toBe(basename(dir))
  events = []
  const renamed = host.renameProject(project.id, '  我的项目  ')
  expect(renamed).toMatchObject({ id: project.id, name: '我的项目', path: project.path })
  expect(existsSync(dir)).toBe(true)
  expect(events).toEqual([{ kind: 'projects', projects: [renamed] }])
  expect(makeHost().projects()).toEqual([renamed])
})

it('空名、控制字符、超长名和不存在的项目都会拒绝，原名不变', () => {
  const host = makeHost()
  const project = host.addProject(mkdtempSync(join(root, 'proj-')))
  expect(() => host.renameProject(project.id, '   ')).toThrow('项目名称不能为空')
  expect(() => host.renameProject(project.id, 42)).toThrow('项目名称不能为空')
  expect(() => host.renameProject(project.id, 'a\nb')).toThrow('换行或控制字符')
  expect(() => host.renameProject(project.id, '项'.repeat(101))).toThrow('不能超过 100 个字符')
  expect(host.renameProject(project.id, '项'.repeat(100)).name).toHaveLength(100)
  expect(() => host.renameProject('missing', 'x')).toThrow('项目不存在')
})

it('移除项目保留磁盘文件夹，重新添加同一目录得到新项目', () => {
  const dir = mkdtempSync(join(root, 'proj-'))
  const host = makeHost()
  const project = host.addProject(dir)
  host.removeProject(project.id)
  expect(host.projects()).toEqual([])
  expect(existsSync(dir)).toBe(true)
  expect(host.addProject(dir).id).not.toBe(project.id)
})

it('一次加多个：按顺序加到最后，已在列表里的和重复的只算一次，不存在的记原因；只保存、广播一次', () => {
  const a = mkdtempSync(join(root, 'a-'))
  const b = mkdtempSync(join(root, 'b-'))
  const host = makeHost()
  const old = host.addProject(a)
  events = []
  const missing = join(root, 'missing')
  const result = host.addProjects([b, a, missing, b])
  expect(result.added.map(p => p.path)).toEqual([b])
  expect(result.existing).toEqual([old])
  expect(result.failed).toEqual([{ path: missing, error: `目录不存在：${missing}` }])
  expect(host.projects().map(p => p.path)).toEqual([a, b])
  expect(events).toEqual([{ kind: 'projects', projects: host.projects() }])
  expect(makeHost().projects()).toEqual(host.projects())
})

it('一次加多个时都已在列表里或都加不上：不保存、不广播', () => {
  const a = mkdtempSync(join(root, 'a-'))
  const host = makeHost()
  host.addProject(a)
  events = []
  const result = host.addProjects([a, join(root, 'nope')])
  expect(result.added).toEqual([])
  expect(events).toEqual([])
  expect(() => host.addProject(join(root, 'nope'))).toThrow('目录不存在')
})
