import { describe, expect, it } from 'vitest'
import { interceptArgv } from '../src/argv.ts'

describe('interceptArgv', () => {
  it('拦截包管理 / 更新子命令，非零退出，中英文提示', () => {
    for (const cmd of ['install', 'remove', 'uninstall', 'update']) {
      const r = interceptArgv([cmd, 'npm:foo'])
      expect(r.action).toBe('blocked')
      if (r.action === 'blocked') {
        expect(r.exitCode).not.toBe(0)
        expect(r.message).toContain('不可用')
        expect(r.message).toContain('not available')
      }
    }
  })

  it('login / logout / share / changelog 单独出现才拦，带别的词视为普通提问', () => {
    for (const cmd of ['login', 'logout', 'share', 'changelog']) {
      expect(interceptArgv([cmd]).action).toBe('blocked')
    }
    expect(interceptArgv(['login', 'page', 'is', 'broken']).action).toBe('run')
  })

  it('拦截从 npm / git / 网址加载扩展、技能', () => {
    expect(interceptArgv(['-e', 'npm:foo']).action).toBe('blocked')
    expect(interceptArgv(['--extension', 'git:github.com/a/b']).action).toBe('blocked')
    expect(interceptArgv(['--skill', 'https://x.y/z']).action).toBe('blocked')
    expect(interceptArgv(['-e', './local.ts']).action).toBe('run')
    // `--` 之后是消息，不拦
    expect(interceptArgv(['-p', '--', '-e', 'npm:foo']).action).toBe('run')
  })

  it('默认追加 --no-approve（项目目录资源不加载），位置在 -- 之前', () => {
    expect(interceptArgv(['--mode', 'rpc'])).toEqual({ action: 'run', args: ['--mode', 'rpc', '--no-approve'] })
    expect(interceptArgv([])).toEqual({ action: 'run', args: ['--no-approve'] })
    expect(interceptArgv(['-p', '--', 'hi'])).toEqual({ action: 'run', args: ['-p', '--no-approve', '--', 'hi'] })
  })

  it('用户明确传了 --approve / -a / --no-approve / -na 则不改', () => {
    for (const flag of ['--approve', '-a', '--no-approve', '-na']) {
      expect(interceptArgv([flag, '--mode', 'rpc'])).toEqual({ action: 'run', args: [flag, '--mode', 'rpc'] })
    }
  })

  it('config / list / auth / mcp 子命令原样放行，不追加参数', () => {
    for (const cmd of ['config', 'list', 'auth', 'mcp']) {
      expect(interceptArgv([cmd, 'x'])).toEqual({ action: 'run', args: [cmd, 'x'] })
    }
  })
})
