import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/machines/store', () => ({ machineOf: () => 'local' }))

// 项目根目录 D:/repo（会话的工作目录也是它），只有 src/a.ts 和 README.md 两个文件
const files: Record<string, string[]> = { '': ['README.md'], src: ['a.ts'] }
// 目录不存在时 listExisting 返回 null，不报错（报错的话主进程会把每一次都记成 ERROR）
const list = vi.fn(async (_ref: unknown, dir: string) =>
  files[dir]
    ? {
        entries: files[dir].map(name => ({ name, path: dir ? `${dir}/${name}` : name, kind: 'file' })),
        truncated: false,
      }
    : null,
)
vi.stubGlobal('window', {
  pixelsky: {
    platform: 'win32',
    files: { target: async () => ({ path: 'D:\\repo' }), listExisting: list },
  },
})

const { wholeTextFile, workspaceFilePath } = await import('./pathLinks')

describe('workspaceFilePath', () => {
  beforeEach(() => list.mockClear())

  it('相对路径、绝对路径、大小写不同（Windows）都找得到', async () => {
    const ref = { sessionId: 's1' }
    expect(await workspaceFilePath(ref, 'src/a.ts')).toBe('src/a.ts')
    expect(await workspaceFilePath(ref, './src/A.ts')).toBe('src/A.ts')
    expect(await workspaceFilePath(ref, 'D:\\repo\\README.md')).toBe('README.md')
  })

  it('不存在、在项目外的为 null', async () => {
    const ref = { sessionId: 's2' }
    expect(await workspaceFilePath(ref, 'src/missing.ts')).toBeNull()
    expect(await workspaceFilePath(ref, 'not/created/yet.ts')).toBeNull()
    expect(await workspaceFilePath(ref, '../other/a.ts')).toBeNull()
    expect(await workspaceFilePath(ref, 'C:/elsewhere/a.ts')).toBeNull()
  })

  it('同一个目录短时间内只读一次', async () => {
    const ref = { projectId: 'p-cache' }
    await workspaceFilePath(ref, 'src/a.ts')
    await workspaceFilePath(ref, 'src/b.ts')
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('wholeTextFile', () => {
  it('整段是路径时给出文件和行列', async () => {
    expect(await wholeTextFile({ sessionId: 's3' }, 'src/a.ts:12:3')).toEqual({ path: 'src/a.ts', line: 12, column: 3 })
    expect(await wholeTextFile({ sessionId: 's3' }, 'README.md')).toEqual({
      path: 'README.md',
      line: null,
      column: null,
    })
  })

  it('文字里还有别的内容时不算', async () => {
    expect(await wholeTextFile({ sessionId: 's3' }, 'see src/a.ts')).toBeNull()
    expect(await wholeTextFile({ sessionId: 's3' }, 'src/a.ts,')).toBeNull()
  })
})
