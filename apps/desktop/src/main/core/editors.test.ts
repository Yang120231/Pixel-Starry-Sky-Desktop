import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EDITORS, Editors, editorArgs } from './editors'
import type { ShortcutTarget } from './shortcuts'
import type { TargetResolver } from './workspace-files'

// 检测不开进程（docs/ui/open-with.md）：快捷方式由测试给，版本读 exe 换成固定值
const links = vi.hoisted(() => ({ list: [] as ShortcutTarget[] }))
vi.mock('./shortcuts', () => ({ findShortcuts: async () => links.list }))
vi.mock('./exe-version', () => ({
  exeVersion: async (path: string) => (path.endsWith('Trae CN.exe') ? '3.3.99' : undefined),
}))

const noWorkspace: TargetResolver = () => {
  throw new Error('不用工作区')
}
const dirs: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'editors-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  links.list = []
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Trae 检测与启动', () => {
  it('两种 Trae 都是内置 VS Code 兼容编辑器', () => {
    expect(EDITORS.find(e => e.id === 'trae-cn')).toMatchObject({ exe: 'Trae CN.exe', command: 'trae-cn' })
    expect(EDITORS.find(e => e.id === 'trae')).toMatchObject({ exe: 'Trae.exe', command: 'trae' })
  })
  it('复用 / 新窗口及行列参数原样保留中文、空格和括号', () => {
    expect(editorArgs('code', 'reuse', 'D:\\项目 (1)', 'D:\\项目 (1)\\main.ts', 12, 3)).toEqual([
      '--reuse-window',
      'D:\\项目 (1)',
      '--goto',
      'D:\\项目 (1)\\main.ts:12:3',
    ])
    expect(editorArgs('code', 'new', 'D:\\项目 (1)')).toEqual(['--new-window', 'D:\\项目 (1)'])
  })
})

describe('检测', () => {
  it.runIf(process.platform === 'win32')(
    '装在别处的编辑器靠快捷方式找到，来源是快捷方式，版本读 exe；Trae CN 没选过默认时用它',
    async () => {
      const root = temp()
      const target = join(root, 'D盘', 'Trae CN', 'Trae CN.exe')
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, '')
      links.list = [{ name: 'TraeCode CN', target }]
      const editors = new Editors(temp(), noWorkspace)
      await editors.init()
      const state = await editors.state()
      const item = state.items.find(i => i.path === target)
      expect(item).toMatchObject({ kind: 'trae-cn', source: 'shortcut', version: '3.3.99', available: true })
      expect(state.defaultId).toBe(item!.id)
    },
  )

  it('改默认值、打开程序时用现有结果，不因为过了 60 秒先重新检测', async () => {
    class Counting extends Editors {
      detections = 0
      protected override detect(): ReturnType<Editors['state']> {
        this.detections++
        return super.detect()
      }
    }
    const editors = new Counting(temp(), noWorkspace)
    await editors.init()
    await editors.state()
    expect(editors.detections).toBe(1)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    await editors.preferences({ window: 'new' })
    expect(editors.detections).toBe(1)
    await editors.state()
    expect(editors.detections).toBe(2)
  })
})
