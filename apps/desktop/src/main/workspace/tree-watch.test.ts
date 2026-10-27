import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANGE_LIMIT, createTreeWatcher, type TreeChange } from './tree-watch'

type Listener = (event: string, filename: string | null) => void

function fakeWatch() {
  const watchers = new Map<string, { listener: Listener; watcher: FSWatcher & EventEmitter; closed: boolean }>()
  const watch = (path: string, listener: Listener): FSWatcher => {
    const watcher = new EventEmitter() as FSWatcher & EventEmitter
    const entry = { listener, watcher, closed: false }
    watcher.close = () => {
      entry.closed = true
    }
    watchers.set(path, entry)
    return watcher
  }
  return { watch, watchers }
}

describe('文件树目录监听', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('防抖后一次推送：新增 / 删除归 added，内容修改归 changed，附加文件夹带前缀，.git 只认分支和暂存', () => {
    const { watch, watchers } = fakeWatch()
    const tree = createTreeWatcher({ watch })
    const got: TreeChange[] = []
    const main = join('/', 'p'),
      extra = join('/', 'x')
    tree.subscribe(
      [
        { path: main, prefix: '' },
        { path: extra, prefix: '::1' },
      ],
      c => got.push(c),
    )
    watchers.get(main)!.listener('rename', join('src', 'a.ts'))
    watchers.get(main)!.listener('change', 'b.ts')
    watchers.get(main)!.listener('change', join('.git', 'objects', 'ab', 'cd'))
    watchers.get(extra)!.listener('rename', 'n.txt')
    vi.advanceTimersByTime(499)
    expect(got).toEqual([])
    vi.advanceTimersByTime(1)
    expect(got).toEqual([{ added: ['src/a.ts', '::1/n.txt'], changed: ['b.ts'], git: false, overflow: false }])
    watchers.get(main)!.listener('change', join('.git', 'HEAD'))
    vi.advanceTimersByTime(500)
    expect(got[1]).toEqual({ added: [], changed: [], git: true, overflow: false })
    // .git 里别的变化（对象、日志）不推
    watchers.get(main)!.listener('change', join('.git', 'logs', 'HEAD'))
    vi.advanceTimersByTime(3000)
    expect(got).toHaveLength(2)
  })

  it('一直在变时最多 2 秒推一次；太多或说不清哪里变了就整棵重读', () => {
    const { watch, watchers } = fakeWatch()
    const tree = createTreeWatcher({ watch })
    const got: TreeChange[] = []
    tree.subscribe([{ path: '/p', prefix: '' }], c => got.push(c))
    const fire = watchers.get('/p')!.listener
    for (let i = 0; i < 10; i++) {
      fire('rename', `f${i}`)
      vi.advanceTimersByTime(300)
    }
    expect(got).toHaveLength(1)
    vi.advanceTimersByTime(500)
    for (let i = 0; i <= CHANGE_LIMIT; i++) fire('rename', `g${i}`)
    vi.advanceTimersByTime(500)
    expect(got.at(-1)).toEqual({ added: [], changed: [], git: true, overflow: true })
    fire('rename', null)
    vi.advanceTimersByTime(500)
    expect(got.at(-1)?.overflow).toBe(true)
  })

  it('同一个根目录只开一个监听；最后一个订阅退掉才关，退掉后不再推', () => {
    const { watch, watchers } = fakeWatch()
    const tree = createTreeWatcher({ watch })
    const a = vi.fn(),
      b = vi.fn()
    const offA = tree.subscribe([{ path: '/p', prefix: '' }], a)
    const offB = tree.subscribe([{ path: '/p', prefix: '' }], b)
    expect(watchers.size).toBe(1)
    watchers.get('/p')!.listener('rename', 'x')
    offA()
    vi.advanceTimersByTime(500)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    expect(watchers.get('/p')!.closed).toBe(false)
    offB()
    expect(watchers.get('/p')!.closed).toBe(true)
  })

  it('监听出错或开不起来：不抛错，之后不再推', () => {
    const { watch, watchers } = fakeWatch()
    const tree = createTreeWatcher({ watch })
    const got = vi.fn()
    tree.subscribe([{ path: '/p', prefix: '' }], got)
    watchers.get('/p')!.watcher.emit('error', new Error('EPERM'))
    expect(watchers.get('/p')!.closed).toBe(true)
    const broken = createTreeWatcher({
      watch: () => {
        throw new Error('ENOENT')
      },
    })
    expect(() => broken.subscribe([{ path: '/gone', prefix: '' }], got)()).not.toThrow()
  })
})

// 真实的 fs.watch：Windows、macOS 上递归监听报来的文件名格式（相对根目录、系统分隔符）要能换成树里的路径
describe.skipIf(process.platform === 'linux')('文件树目录监听（真实文件系统）', () => {
  it('新建文件夹里的文件、改文件内容都能收到', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const root = await mkdtemp(join(tmpdir(), 'pixelsky-tree-watch-'))
    const tree = createTreeWatcher({ quietMs: 100, maxWaitMs: 400 })
    const got: TreeChange[] = []
    const off = tree.subscribe([{ path: root, prefix: '' }], c => got.push(c))
    try {
      await mkdir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.ts'), 'x')
      await vi.waitFor(() => expect(got.flatMap(c => c.added)).toContain('src/a.ts'), { timeout: 3000 })
      got.length = 0
      await writeFile(join(root, 'src', 'a.ts'), 'y')
      await vi.waitFor(() => expect(got.flatMap(c => [...c.added, ...c.changed])).toContain('src/a.ts'), {
        timeout: 3000,
      })
    } finally {
      off()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('文件树目录监听：根目录被删、git 锁文件', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('报来根目录自己的完整路径（Windows 上根目录被删）：关掉监听、移出表，之后订阅的重新开', () => {
    const { watch, watchers } = fakeWatch()
    const opened = vi.fn(watch)
    const tree = createTreeWatcher({ watch: opened })
    const got = vi.fn()
    tree.subscribe([{ path: '/p', prefix: '' }], got)
    const first = watchers.get('/p')!
    first.listener('rename', join('/', 'p'))
    vi.advanceTimersByTime(3000)
    expect(first.closed).toBe(true)
    expect(got).not.toHaveBeenCalled()
    tree.subscribe([{ path: '/p', prefix: '' }], got)
    expect(opened).toHaveBeenCalledTimes(2)
  })

  it('锁文件和嵌套仓库的 .git 不算', () => {
    const { watch, watchers } = fakeWatch()
    const tree = createTreeWatcher({ watch })
    const got = vi.fn()
    tree.subscribe([{ path: '/p', prefix: '' }], got)
    watchers.get('/p')!.listener('rename', join('.git', 'index.lock'))
    watchers.get('/p')!.listener('change', join('vendor', 'x', '.git', 'HEAD'))
    vi.advanceTimersByTime(3000)
    expect(got).not.toHaveBeenCalled()
  })
})
