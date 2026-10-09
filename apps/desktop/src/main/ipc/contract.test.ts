import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CONTRACT, REMOTE_PROTOCOL, type IpcChannelSpec } from '@pixelsky/protocol'
import { describe, expect, it } from 'vitest'

// 静态扫描 main / preload / 远端运行时的源码，保证它们和 packages/protocol 的 IPC 契约说的是同一个通道集合。
// 通道名有几种写法（字面量、`'前缀:' + name`、包装函数），扫描器只认下面这几种；出现新写法时「站点数」检查会失败，
// 到时要么改成已有写法，要么在这里补一种。
const contract = IPC_CONTRACT as Record<string, IpcChannelSpec>
const mainDir = fileURLToPath(new URL('..', import.meta.url))
const preloadDir = fileURLToPath(new URL('../../preload', import.meta.url))
const contractFile = fileURLToPath(new URL('../../../../../packages/protocol/src/ipc/contract.ts', import.meta.url))

/** 远端方法表里不对应任何通道的辅助方法：握手，以及远端 → 本机会话回调用的平台请求。 */
const HELPER_METHODS = ['hello', 'platform:request', 'platform:record']

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
const sources = (dir: string): { file: string; text: string }[] =>
  walk(dir)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'))
    .map(file => ({ file: file.replace(dir, '').replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }))
const names = (text: string, pattern: RegExp, group = 1): string[] => [...text.matchAll(pattern)].map(m => m[group])
const keys = (kind: (spec: IpcChannelSpec) => boolean): string[] =>
  Object.keys(contract)
    .filter(channel => kind(contract[channel]))
    .sort()

/** main 里注册的通道：handle → invoke，on / once → send / sendSync。 */
function registeredChannels(): { handle: string[]; on: string[] } {
  const handle = new Set<string>(),
    on = new Set<string>()
  for (const { file, text } of sources(mainDir)) {
    const sites = names(text, /ipcMain\.(?:handle|on|once)\(/g, 0).length
    const direct = [...text.matchAll(/ipcMain\.(handle|on|once)\(\s*'([^']+)'\s*,/g)]
    const prefixed = [...text.matchAll(/ipcMain\.handle\(\s*'(\w+:)'\s*\+\s*(\w+)\s*,/g)]
    const wrapped = names(text, /ipcMain\.handle\(\s*(\w+)\s*,/g)
    expect(direct.length + prefixed.length + wrapped.length, `${file}: unrecognised ipcMain registration`).toBe(sites)
    for (const m of direct) (m[1] === 'handle' ? handle : on).add(m[2])
    // 包装函数 handle('files:list', …)：名字写全，包装函数原样注册
    const calls = names(text, /\bhandle\(\s*'([^']+)'\s*,/g)
    if (wrapped.length) for (const name of calls) if (name.includes(':')) handle.add(name)
    const short = calls.filter(name => !name.includes(':'))
    let shortOwners = 0
    for (const [, prefix, variable] of prefixed) {
      const loop = text.match(new RegExp(`for \\(const ${variable} of \\[([^\\]]*)\\]`))
      const entries = text.match(
        new RegExp(`for \\(const \\[${variable},[^\\]]*\\] of Object\\.entries\\((\\w+)\\)\\)`),
      )
      if (loop) for (const name of names(loop[1], /'(\w+)'/g)) handle.add(prefix + name)
      else if (entries) {
        // `const actions: … = { state: …, save: … }`：键在 4 空格缩进的行首
        const body = text.match(new RegExp(`const ${entries[1]}\\b[^\\n]*=\\s*\\{\\n([\\s\\S]*?)\\n  \\}\\n`))
        expect(body, `${file}: cannot read ${entries[1]}`).not.toBeNull()
        for (const name of names(body![1], /^ {4}(\w+):/gm)) handle.add(prefix + name)
      } else {
        shortOwners++
        for (const name of short) handle.add(prefix + name)
      }
    }
    expect(shortOwners, `${file}: short handle() names need exactly one prefix`).toBeLessThanOrEqual(1)
    if (short.length) expect(shortOwners, `${file}: handle('${short[0]}') has no prefix`).toBe(1)
  }
  return { handle: [...handle].sort(), on: [...on].sort() }
}

/** preload 用到的通道字符串，按调用方式分组。 */
function preloadChannels(): Record<'invoke' | 'send' | 'sendSync' | 'on', string[]> {
  const found = {
    invoke: new Set<string>(),
    send: new Set<string>(),
    sendSync: new Set<string>(),
    on: new Set<string>(),
  }
  for (const { text } of sources(preloadDir)) {
    for (const name of names(text, /\bcall\(\s*'([^']+)'/g)) found.invoke.add(name)
    for (const m of text.matchAll(/ipcRenderer\.(invoke|send|sendSync|on|once)\(\s*'([^']+)'/g))
      found[m[1] === 'once' ? 'on' : (m[1] as 'invoke' | 'send' | 'sendSync' | 'on')].add(m[2])
  }
  return {
    invoke: [...found.invoke].sort(),
    send: [...found.send].sort(),
    sendSync: [...found.sendSync].sort(),
    on: [...found.on].sort(),
  }
}

/** 远端运行时方法表的键（契约方法表 + 辅助方法表）。 */
function remoteMethods(): string[] {
  const text = readFileSync(join(mainDir, 'machines/remote-runtime.ts'), 'utf8')
  const start = text.indexOf('const contractMethods: Record<'),
    end = text.indexOf('\n  const methods: Record<', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return [...text.slice(start, end).matchAll(/^ {4}(?:'([^']+)'|(\w+)):/gm)].map(m => m[1] ?? m[2]).sort()
}

describe('IPC contract shape', () => {
  it('lists every channel of the app', () => {
    expect(Object.keys(contract).length).toBeGreaterThanOrEqual(179)
    expect(Object.keys(contract).every(channel => /^\w+:\w+$/.test(channel))).toBe(true)
  })
  it('keeps the fields consistent', () => {
    for (const [channel, spec] of Object.entries(contract)) {
      expect(spec.kind === 'push', `${channel}: push`).toBe(spec.route === 'push')
      if (spec.kind === 'push') expect(spec.trust, `${channel}: trust`).toBe('none')
      if (spec.kind !== 'invoke') expect(['local', 'self', 'push'], `${channel}: route`).toContain(spec.route)
      expect(!!spec.ids, `${channel}: ids`).toBe(!!spec.remote)
      if (spec.special) expect(spec.route, `${channel}: special`).toBe('selected')
      if (spec.picker) expect(['selected', 'resource'], `${channel}: picker`).toContain(spec.route)
      expect(!(spec.picker && spec.special), `${channel}: picker + special`).toBe(true)
      if (spec.ids) expect(spec.ids.every(index => Number.isInteger(index) && index >= 0)).toBe(true)
    }
  })
  it('is pure data: no imports', () => {
    expect(readFileSync(contractFile, 'utf8')).not.toMatch(/^\s*import\s/m)
  })
  it('exports the remote protocol version', () => {
    expect(REMOTE_PROTOCOL).toBe(1)
    const runtime = readFileSync(join(mainDir, 'machines/remote-runtime.ts'), 'utf8')
    expect(runtime).not.toMatch(/export const REMOTE_PROTOCOL/)
    expect(runtime).toMatch(/protocol: REMOTE_PROTOCOL/)
  })
})

describe('IPC contract vs main', () => {
  it('registers exactly the non-push channels of the contract', () => {
    const registered = registeredChannels()
    expect(registered.handle).toEqual(keys(spec => spec.kind === 'invoke'))
    expect(registered.on).toEqual(keys(spec => spec.kind === 'send' || spec.kind === 'sendSync'))
  })
  it('only sends declared push channels', () => {
    const sent = new Set<string>()
    for (const { text } of sources(mainDir))
      for (const name of names(text, /\.(?:send|broadcast|event)\(\s*'([^']+)'/g)) sent.add(name)
    expect(sent.size).toBeGreaterThan(5)
    for (const name of sent) expect(contract[name]?.kind, name).toBe('push')
  })
})

describe('IPC contract vs preload', () => {
  const found = preloadChannels()
  it('only uses declared channels, with the declared kind', () => {
    expect(found.invoke.length).toBeGreaterThan(100)
    for (const name of found.invoke) expect(contract[name]?.kind, name).toBe('invoke')
    for (const name of found.send) expect(contract[name]?.kind, name).toBe('send')
    for (const name of found.sendSync) expect(contract[name]?.kind, name).toBe('sendSync')
    for (const name of found.on) expect(contract[name]?.kind, name).toBe('push')
  })
  it('listens to every push channel', () => {
    expect(found.on).toEqual(keys(spec => spec.kind === 'push'))
  })
  it('reaches every non-push channel', () => {
    const used = new Set([...found.invoke, ...found.send, ...found.sendSync])
    expect(keys(spec => spec.kind !== 'push').filter(channel => !used.has(channel))).toEqual([])
  })
})

describe('IPC contract vs remote runtime', () => {
  const methods = remoteMethods()
  const declared = [...new Set(Object.values(contract).flatMap(spec => (spec.remote ? [spec.remote] : [])))].sort()
  it('implements every declared remote method', () => {
    expect(methods.length).toBeGreaterThan(80)
    expect(methods.filter(method => !declared.includes(method) && !HELPER_METHODS.includes(method))).toEqual([])
    expect(declared.filter(method => !methods.includes(method))).toEqual([])
  })
  it('lists the helper methods as real methods', () => {
    for (const method of HELPER_METHODS) expect(methods, method).toContain(method)
    for (const method of HELPER_METHODS) expect(declared, method).not.toContain(method)
  })
  it('calls only methods the runtime has', () => {
    const called = new Set<string>()
    for (const { file, text } of sources(mainDir))
      if (!file.endsWith('machines/remote-runtime.ts'))
        for (const name of names(text, /\.call(?:<[^>]*>)?\([^,()]+,\s*'([^']+)'/g)) called.add(name)
    expect(called.size).toBeGreaterThan(2)
    for (const name of called) expect(methods, name).toContain(name)
  })
  it('maps channels to methods through the contract only', () => {
    const mapped: string[] = []
    for (const { file, text } of sources(mainDir))
      for (const name of names(text, /\bremoteMethod\(\s*'([^']+)'\s*\)/g)) {
        expect(contract[name]?.remote, `${file}: ${name}`).toBeDefined()
        mapped.push(contract[name].remote!)
      }
    expect(mapped.length).toBeGreaterThanOrEqual(4)
    for (const method of mapped) expect(methods, method).toContain(method)
  })
})
