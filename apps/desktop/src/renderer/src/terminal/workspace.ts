import type { TerminalRecord } from '../../../shared/types/terminal'
/** A worktree is a different working directory even when it belongs to the same project. */
export function workspaceTerminals(
  items: TerminalRecord[],
  projectId: string | null,
  path: string,
  windows: boolean,
): TerminalRecord[] {
  const key = (value: string) => {
    const normalized = value.replaceAll('\\', '/').replace(/\/$/, '')
    return windows ? normalized.toLowerCase() : normalized
  }
  return items.filter(item => item.projectId === projectId && (!path || key(item.cwd) === key(path)))
}
