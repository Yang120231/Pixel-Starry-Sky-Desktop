import { describe, expect, it } from 'vitest'
import type { EngineHost } from '@pixelsky/engine'
import type { ProjectRecord, SessionRecord } from '@pixelsky/protocol'
import { resolveLocalWorkspace } from './resolve'
import { workspaceRef } from '../workspace-files'

const project: ProjectRecord = {
  id: 'p1',
  name: '应用',
  path: 'D:/work/app',
  folders: [{ path: 'D:/work/docs' }, { path: 'E:/shared', name: '共享' }],
  addedAt: 1,
}
const sessions: Record<string, Partial<SessionRecord>> = {
  main: { id: 'main', projectId: 'p1', cwd: 'D:/work/app', extraDirs: ['D:/old'], title: 't' },
  copy: { id: 'copy', projectId: 'p1', cwd: 'D:/work/app-copy', extraDirs: ['D:/old'], title: 't' },
}
const host = {
  projects: () => [project],
  record: (id: string) => sessions[id] as SessionRecord | undefined,
} as unknown as EngineHost

describe('resolveLocalWorkspace：多文件夹项目（docs/ui/multi-root-projects.md §3.4）', () => {
  it('项目带上附加文件夹（显示名缺省用文件夹名）', () => {
    expect(resolveLocalWorkspace(host, { projectId: 'p1' })).toEqual({
      ref: { projectId: 'p1' },
      path: 'D:/work/app',
      name: '应用',
      folders: [
        { path: 'D:/work/docs', name: 'docs' },
        { path: 'E:/shared', name: '共享' },
      ],
    })
  })
  it('在主文件夹的会话按项目看；副本里的会话用它创建时抄下的', () => {
    expect(resolveLocalWorkspace(host, { sessionId: 'main' }).folders?.map(f => f.path)).toEqual([
      'D:/work/docs',
      'E:/shared',
    ])
    expect(resolveLocalWorkspace(host, { sessionId: 'copy' }).folders).toEqual([{ path: 'D:/old', name: 'old' }])
  })
  it('folder：工作区就是那个附加文件夹；没有这个编号报错', () => {
    expect(resolveLocalWorkspace(host, { projectId: 'p1', folder: 2 })).toEqual({
      ref: { projectId: 'p1', folder: 2 },
      path: 'E:/shared',
      name: '应用 · 共享',
    })
    expect(() => resolveLocalWorkspace(host, { projectId: 'p1', folder: 3 })).toThrow('没有这个文件夹')
  })
  it('workspaceRef 只收 1–20 的整数编号', () => {
    expect(workspaceRef({ projectId: 'p', folder: 2 })).toEqual({ projectId: 'p', folder: 2 })
    expect(workspaceRef({ projectId: 'p', folder: 0 })).toEqual({ projectId: 'p' })
    expect(workspaceRef({ sessionId: 's', folder: '1' })).toEqual({ sessionId: 's' })
    expect(workspaceRef({ sessionId: 's', folder: 21 })).toEqual({ sessionId: 's' })
  })
})
