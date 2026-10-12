// 快捷方式解析（docs/ui/open-with.md）：按 MS-SHLLINK 格式拼出各种快捷方式来测；
// 和 Windows 自己建的快捷方式逐个核对在 scratch 里做过（本机 157 个指着 exe 的全部一致）
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandEnv, findShortcuts, shortcutTargets } from './shortcuts'

const u16 = (text: string): Buffer => Buffer.from(text + '\0', 'utf16le')
const word = (n: number): Buffer => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}

/** LinkInfo：单字节的本地路径，可选再带 Unicode 的 */
function linkInfo(ansi: Buffer, unicode?: string): Buffer {
  const headerSize = unicode ? 0x24 : 0x1c
  const volume = Buffer.alloc(0x11)
  volume.writeUInt32LE(0x11, 0)
  volume.writeUInt32LE(0x10, 12)
  const parts: Buffer[] = [volume, Buffer.concat([ansi, Buffer.alloc(1)]), Buffer.alloc(1)]
  if (unicode) parts.push(u16(unicode), Buffer.alloc(2))
  const offsets: number[] = []
  let at = headerSize
  for (const p of parts) {
    offsets.push(at)
    at += p.length
  }
  const h = Buffer.alloc(headerSize)
  h.writeUInt32LE(at, 0)
  h.writeUInt32LE(headerSize, 4)
  h.writeUInt32LE(1, 8)
  h.writeUInt32LE(offsets[0], 12)
  h.writeUInt32LE(offsets[1], 16)
  h.writeUInt32LE(offsets[2], 24)
  if (unicode) {
    h.writeUInt32LE(offsets[3], 28)
    h.writeUInt32LE(offsets[4], 32)
  }
  return Buffer.concat([h, ...parts])
}

/** ID 列表：此电脑 → 盘符 → 每一级（扩展块 v9 里放长文件名，主名字放 8.3 短名） */
function idList(drive: string, names: string[], root = 'e04fd020ea3a6910a2d808002b30309d'): Buffer {
  const computer = Buffer.concat([word(20), Buffer.from([0x1f, 0x50]), Buffer.from(root, 'hex')])
  const volume = Buffer.alloc(25)
  volume.writeUInt16LE(25, 0)
  volume[2] = 0x2f
  volume.write(drive + '\\', 3, 'latin1')
  const items = names.map((name, i) => {
    const ext = Buffer.alloc(46)
    ext.writeUInt16LE(9, 2)
    ext.writeUInt32LE(0xbeef0004, 4)
    const block = Buffer.concat([ext, u16(name), Buffer.alloc(2)])
    block.writeUInt16LE(block.length, 0)
    const head = Buffer.alloc(14)
    head[2] = i === names.length - 1 ? 0x32 : 0x31
    const item = Buffer.concat([head, Buffer.from('X~1\0', 'latin1'), block])
    item.writeUInt16LE(item.length, 0)
    return item
  })
  return Buffer.concat([computer, volume, ...items, Buffer.alloc(2)])
}

interface Parts {
  idList?: Buffer
  linkInfo?: Buffer
  relative?: string
  envTarget?: string
  flags?: number
}

/** 按格式拼一个快捷方式：头、ID 列表、LinkInfo、字符串（Unicode）、扩展块 */
function lnk(p: Parts): Buffer {
  let flags = (p.flags ?? 0) | 0x80
  const body: Buffer[] = []
  if (p.idList) {
    flags |= 0x1
    body.push(word(p.idList.length), p.idList)
  }
  if (p.linkInfo) {
    flags |= 0x2
    body.push(p.linkInfo)
  }
  if (p.relative !== undefined) {
    flags |= 0x8
    body.push(word(p.relative.length), Buffer.from(p.relative, 'utf16le'))
  }
  if (p.envTarget) {
    flags |= 0x200
    const block = Buffer.alloc(0x314)
    block.writeUInt32LE(0x314, 0)
    block.writeUInt32LE(0xa0000001, 4)
    block.write(p.envTarget, 8, 'latin1')
    block.write(p.envTarget, 8 + 260, 'utf16le')
    body.push(block)
  }
  body.push(Buffer.alloc(4))
  const header = Buffer.alloc(0x4c)
  header.writeUInt32LE(0x4c, 0)
  Buffer.from('0114020000000000c000000000000046', 'hex').copy(header, 4)
  header.writeUInt32LE(flags, 0x14)
  return Buffer.concat([header, ...body])
}

const gbk = (...parts: (string | Buffer)[]): Buffer =>
  Buffer.concat(parts.map(p => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)))
/** 「工具」「编辑器」的 GBK 编码 */
const TOOLS = Buffer.from('b9a4bedf', 'hex'),
  EDITOR = Buffer.from('b1e0bcadc6f7', 'hex')

describe('快捷方式的目标', () => {
  it('环境变量形式的目标展开后排最前（变量名不分大小写）', () => {
    const data = lnk({
      envTarget: '%LocalAppData%\\Programs\\Trae CN\\Trae CN.exe',
      linkInfo: linkInfo(Buffer.from('C:\\Old\\Trae CN.exe')),
    })
    expect(shortcutTargets(data, 'C:\\Menu\\Trae.lnk', { LOCALAPPDATA: 'D:\\U\\Local' })).toEqual([
      'D:\\U\\Local\\Programs\\Trae CN\\Trae CN.exe',
      'C:\\Old\\Trae CN.exe',
    ])
    expect(expandEnv('%MISSING%\\a.exe', {})).toBe('%MISSING%\\a.exe')
  })

  it('LinkInfo：Unicode 的路径在前；单字节的中文路径按几种代码页都解，GBK 的能解对', () => {
    const both = lnk({ linkInfo: linkInfo(Buffer.from('C:\\A.exe'), 'D:\\编辑器\\A.exe') })
    expect(shortcutTargets(both, 'C:\\x.lnk').slice(0, 2)).toEqual(['D:\\编辑器\\A.exe', 'C:\\A.exe'])
    const ansi = lnk({ linkInfo: linkInfo(gbk('D:\\', TOOLS, '\\', EDITOR, '.exe')) })
    expect(shortcutTargets(ansi, 'C:\\x.lnk')).toContain('D:\\工具\\编辑器.exe')
  })

  it('只有 ID 列表时按「此电脑 → 盘符 → 各级长文件名」拼出路径；别的根不认', () => {
    const data = lnk({ idList: idList('D:', ['Program Files', '工具', 'FlClash.exe']) })
    expect(shortcutTargets(data, 'C:\\x.lnk')).toEqual(['D:\\Program Files\\工具\\FlClash.exe'])
    const other = lnk({ idList: idList('D:', ['a.exe'], '00000000000000000000000000000000') })
    expect(shortcutTargets(other, 'C:\\x.lnk')).toEqual([])
  })

  it('相对路径按快捷方式所在目录算，排在最后', () => {
    const data = lnk({ linkInfo: linkInfo(Buffer.from('E:\\A\\A.exe')), relative: '..\\..\\Apps\\A.exe' })
    expect(shortcutTargets(data, 'C:\\Users\\me\\Menu\\A.lnk')).toEqual(['E:\\A\\A.exe', 'C:\\Users\\Apps\\A.exe'])
  })

  it('MSI 播发的、格式不对的返回空；读到一半坏了的返回已经拿到的，不报错', () => {
    expect(shortcutTargets(lnk({ linkInfo: linkInfo(Buffer.from('C:\\A.exe')), flags: 1 << 12 }), 'x.lnk')).toEqual([])
    expect(shortcutTargets(Buffer.from('not a shortcut at all, just some text'), 'x.lnk')).toEqual([])
    expect(shortcutTargets(Buffer.alloc(0), 'x.lnk')).toEqual([])
    const full = lnk({ linkInfo: linkInfo(Buffer.from('C:\\A.exe')), relative: '..\\B\\B.exe' })
    expect(shortcutTargets(full.subarray(0, full.length - 10), 'C:\\M\\x.lnk')).toEqual(['C:\\A.exe'])
    for (let cut = 0; cut < full.length; cut += 7)
      expect(() => shortcutTargets(full.subarray(0, cut), 'x.lnk')).not.toThrow()
  })
})

describe('找本机的快捷方式', () => {
  it.runIf(process.platform === 'win32')(
    '开始菜单（含子目录）和桌面：只要指着实际存在的 exe 的，同一个程序只留一条',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'shortcuts-'))
      try {
        const env = {
          ProgramData: join(root, 'ProgramData'),
          APPDATA: join(root, 'AppData'),
          PUBLIC: join(root, 'Public'),
          USERPROFILE: join(root, 'Me'),
        }
        const exe = join(root, 'Apps', '编辑器', 'Code.exe'),
          text = join(root, 'Apps', 'readme.txt')
        mkdirSync(join(exe, '..'), { recursive: true })
        writeFileSync(exe, '')
        writeFileSync(text, '')
        const menu = join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Editors')
        mkdirSync(menu, { recursive: true })
        mkdirSync(join(env.PUBLIC, 'Desktop'), { recursive: true })
        const to = (target: string): Buffer => lnk({ linkInfo: linkInfo(Buffer.from('X:\\none.exe'), target) })
        writeFileSync(join(menu, 'Visual Studio Code.lnk'), to(exe))
        writeFileSync(join(menu, 'Gone.lnk'), to(join(root, 'Apps', 'gone.exe')))
        writeFileSync(join(menu, 'Readme.lnk'), to(text))
        writeFileSync(join(env.PUBLIC, 'Desktop', 'Code.lnk'), to(exe))
        expect(await findShortcuts(env)).toEqual([{ name: 'Visual Studio Code', target: exe }])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
