import { expect, it } from 'vitest'
import type { TerminalRecord } from '../../../../shared/types/terminal'
import { workspaceTerminals } from './workspace'

it('keeps worktree processes separate when they share a project id', () => {
  const items = [
    { id: 'main', projectId: 'p', cwd: 'D:\\project' },
    { id: 'copy', projectId: 'p', cwd: 'D:\\project-copy' },
    { id: 'other', projectId: 'q', cwd: 'D:\\project' },
  ] as TerminalRecord[]
  expect(workspaceTerminals(items, 'p', 'd:/project-copy/', true).map(t => t.id)).toEqual(['copy'])
  expect(workspaceTerminals(items, 'p', 'd:/project-copy/', false)).toEqual([])
  expect(workspaceTerminals(items, 'p', '', true).map(t => t.id)).toEqual(['main', 'copy'])
})
