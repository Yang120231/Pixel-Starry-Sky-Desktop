import { describe, expect, it } from 'vitest'
import { splitInstallCommand } from './installCommand'

describe('splitInstallCommand', () => {
  it('拿出 PowerShell / 终端 / npm 的安装命令', () => {
    expect(
      splitInstallCommand('没找到 Claude Code。安装：在 PowerShell 运行 irm https://claude.ai/install.ps1 | iex'),
    ).toEqual({
      before: '没找到 Claude Code。安装：在 PowerShell 运行',
      command: 'irm https://claude.ai/install.ps1 | iex',
      after: '',
    })
    expect(
      splitInstallCommand('Claude Code not found. Install it in PowerShell: irm https://claude.ai/install.ps1 | iex'),
    ).toMatchObject({
      before: 'Claude Code not found. Install it in PowerShell',
      command: 'irm https://claude.ai/install.ps1 | iex',
    })
    expect(
      splitInstallCommand('没找到 Claude Code。安装：在终端运行 curl -fsSL https://claude.ai/install.sh | bash')
        .command,
    ).toBe('curl -fsSL https://claude.ai/install.sh | bash')
    expect(splitInstallCommand('没找到 node / npm，请在终端运行 npm i -g @openai/codex@latest').command).toBe(
      'npm i -g @openai/codex@latest',
    )
  })

  it('没有命令时原样返回', () => {
    expect(splitInstallCommand('没找到 Claude Code')).toEqual({
      before: '没找到 Claude Code',
      command: null,
      after: '',
    })
  })
})
