// 会话 ⇄ 终端（TUI）：起 Claude Code 的 pty（docs/ui/tui-toggle.md §4.2）。从 ipc.ts 拆出来好单测
import type { TerminalManager } from '../terminal/manager'

type Terminals = Pick<TerminalManager, 'spawnCommand' | 'change'>
type SpawnOpts = Parameters<TerminalManager['spawnCommand']>[0]

/** prepareTui 已经标了终端模式：起不来就撤掉，不然会话卡在没有终端的终端模式里 */
export async function spawnTui(terminals: Terminals, clearTui: (sessionId: string) => void, opts: SpawnOpts) {
  let term
  try {
    term = terminals.spawnCommand(opts)
  } catch (err) {
    clearTui(opts.sessionId)
    throw err
  }
  // pty.spawn 失败（Windows 上 CLI 路径失效报 File not found）不抛错，只把记录标成 error
  if (term.status === 'error') {
    await terminals.change(opts.owner, term.id, false, true).catch(() => {})
    clearTui(opts.sessionId)
    throw new Error(term.error ?? '终端启动失败')
  }
  return term
}
