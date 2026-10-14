import { describe, expect, it } from 'vitest'
import type { CheckItem, WslDistro } from '../../shared/types/machines'
import { wslMachineId } from './wslList'
import { checkNodePath, mergeWsl, parseWslRecords, persistableRecords, type WslRecord } from './wslMachines'

const distro = (name: string, extra: Partial<WslDistro> = {}): WslDistro => ({
  name,
  state: 'stopped',
  version: 2,
  isDefault: false,
  ...extra,
})
const record = (name: string, extra: Partial<WslRecord> = {}): WslRecord => ({
  id: wslMachineId(name),
  distro: name,
  ...extra,
})
const item: CheckItem = { key: 'node', status: 'ok', required: true, detail: 'v22' }

describe('parseWslRecords', () => {
  it('只认 wsl- 加 12 位十六进制，且与发行版名对得上', () => {
    const good = record('Ubuntu', { nodePath: '/home/a/bin/node', lastCheck: { at: 1, items: [item] } })
    const list = parseWslRecords({
      machines: [
        good,
        { id: 'ssh-abc', distro: 'X' },
        { id: 'wsl-123', distro: 'X' },
        { id: wslMachineId('A'), distro: 'B' },
        { id: wslMachineId('C'), distro: 5 },
        null,
      ],
    })
    expect(list).toEqual([good])
  })
  it('重复 id 只留第一条，坏的 node 路径和检查结果丢掉', () => {
    const list = parseWslRecords({
      machines: [
        record('Ubuntu', { nodePath: '/mnt/c/node.exe', lastCheck: { at: 1, items: [{ bad: 1 }] as never } }),
        record('Ubuntu'),
      ],
    })
    expect(list).toEqual([record('Ubuntu')])
  })
  it('文件内容不对时返回空', () => {
    expect(parseWslRecords(null)).toEqual([])
    expect(parseWslRecords({ machines: 'x' })).toEqual([])
  })
})

describe('persistableRecords', () => {
  it('没有 node 路径也没有检查结果的不写盘', () => {
    const kept = record('A', { nodePath: '/usr/bin/node' })
    expect(persistableRecords([record('B'), kept])).toEqual([kept])
  })
})

describe('checkNodePath', () => {
  it('接受绝对 Linux 路径并去掉首尾空白', () => {
    expect(checkNodePath(' /home/a/.nvm/versions/node/v22/bin/node ')).toBe('/home/a/.nvm/versions/node/v22/bin/node')
  })
  it.each(['node', '', 'C:\node.exe', '/mnt/c/node.exe', '/a\nb', '/a\0b', 5, null])('拒绝 %j', value => {
    expect(() => checkNodePath(value)).toThrow('WSL_NODE_PATH_INVALID')
  })
})

describe('mergeWsl', () => {
  it('列表里的都显示，没有记录的先建一条', () => {
    const records = new Map<string, WslRecord>()
    const shown = mergeWsl(records, [distro('Ubuntu', { isDefault: true }), distro('Debian')], new Set())
    expect(shown.map(e => e.record.distro)).toEqual(['Ubuntu', 'Debian'])
    expect(records.size).toBe(2)
    expect(shown[0].distro?.isDefault).toBe(true)
  })
  it('已有记录保留检查结果', () => {
    const old = record('Ubuntu', { lastCheck: { at: 5, items: [] } })
    const records = new Map([[old.id, old]])
    const [entry] = mergeWsl(records, [distro('Ubuntu')], new Set())
    expect(entry.record).toBe(old)
    expect(entry.record.lastCheck?.at).toBe(5)
  })
  it('列表里没有了：没连接就隐藏，记录留着', () => {
    const old = record('Gone')
    const records = new Map([[old.id, old]])
    expect(mergeWsl(records, [], new Set())).toEqual([])
    expect(records.has(old.id)).toBe(true)
  })
  it('列表里没有了但已连接：保留，distro 为 null', () => {
    const old = record('Gone')
    const shown = mergeWsl(new Map([[old.id, old]]), [], new Set([old.id]))
    expect(shown).toEqual([{ record: old, distro: null }])
  })
})
