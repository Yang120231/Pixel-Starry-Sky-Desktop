// 起会话 TUI 失败要撤掉终端模式（docs/ui/tui-toggle.md §4.2）
import { describe, expect, it, vi } from 'vitest'
import type { TerminalRecord } from '../../shared/types/terminal'
import { spawnTui } from './tui-spawn'

const opts = {
  owner: 1,
  cwd: 'D:/p',
  command: 'claude',
  args: [],
  label: 'Claude Code',
  sessionId: 's1',
  projectId: 'p1',
  projectName: 'p',
}
const fake = (term: Partial<TerminalRecord>) => ({
  spawnCommand: vi.fn(() => ({ id: 't1', ...term }) as TerminalRecord),
  change: vi.fn(async () => undefined),
})

describe('spawnTui', () => {
  it('returns the terminal when the pty started', async () => {
    const terminals = fake({ status: 'running' })
    const clearTui = vi.fn()
    await expect(spawnTui(terminals, clearTui, opts)).resolves.toMatchObject({ id: 't1' })
    expect(clearTui).not.toHaveBeenCalled()
  })

  it('pty.spawn failed (status error): removes the terminal, clears TUI mode, throws its error', async () => {
    const terminals = fake({ status: 'error', error: 'File not found: ' })
    const clearTui = vi.fn()
    await expect(spawnTui(terminals, clearTui, opts)).rejects.toThrow('File not found')
    expect(terminals.change).toHaveBeenCalledWith(1, 't1', false, true)
    expect(clearTui).toHaveBeenCalledWith('s1')
  })

  it('spawnCommand throws: clears TUI mode and rethrows', async () => {
    const terminals = fake({})
    terminals.spawnCommand.mockImplementation(() => {
      throw new Error('终端正在关闭')
    })
    const clearTui = vi.fn()
    await expect(spawnTui(terminals, clearTui, opts)).rejects.toThrow('终端正在关闭')
    expect(clearTui).toHaveBeenCalledWith('s1')
  })
})
