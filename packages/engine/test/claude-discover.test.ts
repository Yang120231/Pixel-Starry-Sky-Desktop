// 找 npm 装的 Claude Code（docs/engines.md §7）：nvm4w、fnm 等换过 npm 位置时，按 PATH 上的 claude.cmd 找包
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { npmClaude, npmOnPath } from '../src/claude/discover'
import { makeTmp, removeTmp } from './helpers/tmp'

let root: string
beforeEach(() => {
  root = makeTmp('claude-discover-')
})
afterEach(() => removeTmp(root))

const file = (path: string, size: number): string => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(size, 1))
  return path
}
const pkgOf = (prefix: string): string => join(prefix, 'node_modules', '@anthropic-ai', 'claude-code')
const native = `claude${process.platform === 'win32' ? '.exe' : ''}`

describe('npm 装的 Claude Code', () => {
  it('bin/claude.exe 装好了（原生程序）就直接用', () => {
    const exe = file(join(pkgOf(root), 'bin', 'claude.exe'), 200 * 1024)
    expect(npmClaude(pkgOf(root), {})).toEqual({ command: exe, args: [] })
  })

  it('没跑 postinstall（bin/claude.exe 还是占位脚本）：用平台包里的原生程序；都没有就不算找到', () => {
    file(join(pkgOf(root), 'bin', 'claude.exe'), 500)
    expect(npmClaude(pkgOf(root), {})).toBeNull()
    const platform = file(
      join(pkgOf(root), 'node_modules', '@anthropic-ai', `claude-code-${process.platform}-${process.arch}`, native),
      200 * 1024,
    )
    expect(npmClaude(pkgOf(root), {})).toEqual({ command: platform, args: [] })
  })

  it.runIf(process.platform === 'win32')('PATH 上有 nvm4w 之类的 claude.cmd：找它旁边的包', () => {
    const prefix = join(root, 'nvm4w', 'nodejs')
    file(join(prefix, 'claude.cmd'), 300)
    const exe = file(join(pkgOf(prefix), 'bin', 'claude.exe'), 200 * 1024)
    const env = { PATH: [join(root, 'empty'), prefix].join(delimiter), APPDATA: join(root, 'appdata') }
    expect(npmOnPath(env)?.command).toBe(exe)
  })
})
