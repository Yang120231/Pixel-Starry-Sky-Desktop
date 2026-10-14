import { describe, expect, it } from 'vitest'
import { decodeWslOutput, listWsl, parseWslList, visibleDistros, wslMachineId } from './wslList'

const sample = '  NAME      STATE           VERSION\r\n* Ubuntu    Stopped         2\r\n'
const utf16 = (s: string, bom: boolean) =>
  Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')])

describe('decodeWslOutput', () => {
  it('解码带 BOM 的 UTF-16LE', () => {
    expect(decodeWslOutput(utf16(sample, true))).toBe(sample.replace(/\r/g, ''))
  })
  it('解码不带 BOM 的 UTF-16LE', () => {
    expect(decodeWslOutput(utf16(sample, false))).toBe(sample.replace(/\r/g, ''))
  })
  it('解码 UTF-8 并去掉 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sample, 'utf8')])
    expect(decodeWslOutput(buf)).toBe(sample.replace(/\r/g, ''))
  })
  it('解码中文为主的 UTF-16LE（无 BOM）', () => {
    const zh =
      '  NAME      STATE           VERSION\r\n* 我的发行版  正在运行        2\r\n  旧系统    已停止          1\r\n'
    const text = decodeWslOutput(utf16(zh, false))
    expect(text).toBe(zh.replace(/\r/g, ''))
    expect(parseWslList(text).map(d => [d.name, d.state])).toEqual([
      ['我的发行版', 'running'],
      ['旧系统', 'stopped'],
    ])
  })
  it('空输出得到空串', () => {
    expect(decodeWslOutput(Buffer.alloc(0))).toBe('')
  })
})

describe('parseWslList', () => {
  it('解析默认发行版', () => {
    expect(parseWslList(sample)).toEqual([{ name: 'Ubuntu', state: 'stopped', version: 2, isDefault: true }])
  })
  it('认中文状态词', () => {
    const text = '  NAME      STATE           VERSION\n* Ubuntu    正在运行        2\n  Old       已停止          1\n'
    const list = parseWslList(text)
    expect(list.map(d => d.state)).toEqual(['running', 'stopped'])
    expect(list[1].version).toBe(1)
  })
  it('不认识的状态记成 unknown', () => {
    expect(parseWslList('NAME STATE VERSION\nUbuntu Zzz 2\n')[0].state).toBe('unknown')
  })
  it('多个发行版并保留带点和横线的名字', () => {
    const text =
      '  NAME              STATE           VERSION\r\n* Ubuntu-24.04      Running         2\r\n  docker-desktop    Stopped         2\r\n  Debian            Installing      2\r\n'
    const list = parseWslList(text)
    expect(list.map(d => d.name)).toEqual(['Ubuntu-24.04', 'docker-desktop', 'Debian'])
    expect(list[0].isDefault).toBe(true)
    expect(list[2].state).toBe('installing')
    expect(visibleDistros(list).map(d => d.name)).toEqual(['Ubuntu-24.04', 'Debian'])
  })
  it('空输出得到空列表', () => {
    expect(parseWslList('')).toEqual([])
  })
  it('没有发行版的提示文字被丢掉', () => {
    const text = 'Windows Subsystem for Linux has no installed distributions.\nUse wsl.exe --install to install.\n'
    expect(parseWslList(text)).toEqual([])
  })
})

describe('visibleDistros', () => {
  it('过滤 Docker、Rancher、Podman 的内部发行版（大小写不敏感）', () => {
    const mk = (name: string) => ({ name, state: 'running' as const, version: 2 as const, isDefault: false })
    const names = ['Docker-Desktop', 'docker-desktop-data', 'rancher-desktop-data', 'podman-machine-default', 'Ubuntu']
    expect(visibleDistros(names.map(mk)).map(d => d.name)).toEqual(['Ubuntu'])
  })
})

describe('wslMachineId', () => {
  it('稳定且大小写无关', () => {
    expect(wslMachineId('Ubuntu-24.04')).toBe(wslMachineId('ubuntu-24.04'))
    expect(wslMachineId('Ubuntu-24.04')).toMatch(/^wsl-[a-f0-9]{12}$/)
    expect(wslMachineId('Debian')).not.toBe(wslMachineId('Ubuntu'))
  })
})

describe('listWsl', () => {
  it('run 返回 null 时返回 null（和空列表区分）', async () => {
    expect(await listWsl(async () => null)).toEqual(process.platform === 'win32' ? null : [])
  })
  it('只在 Windows 上执行', async () => {
    let calls = 0
    const list = await listWsl(async () => {
      calls++
      return utf16(sample, true)
    })
    expect(calls).toBe(process.platform === 'win32' ? 1 : 0)
    expect(list?.length).toBe(process.platform === 'win32' ? 1 : 0)
  })
})
