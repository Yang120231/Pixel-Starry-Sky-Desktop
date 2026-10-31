import { describe, expect, it } from 'vitest'
import type { StatusBarController } from '@/features/engine'
import { folderWorkspace } from './composerWorkspace'

const status = (id: string | null) =>
  ({ project: id ? { id, name: '', path: '' } : null }) as unknown as StatusBarController

describe('输入框的有文件夹的工作区', () => {
  it('「对话」发第一条消息前没有文件夹（本机和远端）', () => {
    expect(folderWorkspace(null, status('chat'), undefined)).toBeNull()
    expect(folderWorkspace(null, status('ssh-1~chat'), undefined)).toBeNull()
  })
  it('已开始的会话、普通项目照常；没选项目时没有', () => {
    expect(folderWorkspace('s1', status('chat'), undefined)).toEqual({ sessionId: 's1' })
    expect(folderWorkspace(null, status('p1'), undefined)).toEqual({ projectId: 'p1' })
    expect(folderWorkspace(null, status(null), undefined)).toBeNull()
  })
})
