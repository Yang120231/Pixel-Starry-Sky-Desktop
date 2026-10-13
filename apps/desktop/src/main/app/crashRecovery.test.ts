// 界面崩溃后自动重新加载（docs/ui/renderer-memory.md §3.1、§4.1）
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const lines = vi.hoisted(() => [] as { level: string; message: string; fields?: Record<string, unknown> }[])
vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }))
vi.mock('@pixelsky/engine', () => ({
  logger: () => {
    const write = (level: string) => (message: string, fields?: Record<string, unknown>) =>
      lines.push({ level, message, fields })
    return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
  },
}))
vi.mock('./ui-language', () => ({ windowLocale: () => 'zh-CN' }))

import { canSend, markReady } from './rendererHealth'
import {
  DELAYS,
  LOAD_TIMEOUT_MS,
  loadApp,
  recoveryStep,
  watchCrashes,
  WINDOW_MS,
  type CrashDeps,
} from './crashRecovery'

describe('recoveryStep', () => {
  it('第 1～3 次分别隔 1 / 2 / 5 秒，第 4、5 次询问', () => {
    let times: number[] = []
    const actions: unknown[] = []
    for (let i = 0; i < 5; i++) {
      const step = recoveryStep(times, i * 1000)
      times = step.times
      actions.push([step.n, step.action])
    }
    expect(actions).toEqual([
      [1, { kind: 'reload', delayMs: DELAYS[0] }],
      [2, { kind: 'reload', delayMs: DELAYS[1] }],
      [3, { kind: 'reload', delayMs: DELAYS[2] }],
      [4, { kind: 'ask' }],
      [5, { kind: 'ask' }],
    ])
    expect(DELAYS).toEqual([1000, 2000, 5000])
  })

  it('10 分钟以前的不算', () => {
    const old = [0, 1000, 2000]
    const step = recoveryStep(old, WINDOW_MS + 2500)
    expect(step.times).toEqual([WINDOW_MS + 2500])
    expect(step.n).toBe(1)
    // 刚好差 10 分钟也不算
    expect(recoveryStep([0], WINDOW_MS).n).toBe(1)
    expect(recoveryStep([1], WINDOW_MS).n).toBe(2)
  })

  it('时间乱序也对', () => {
    expect(recoveryStep([5000, 1000, 3000], 6000).n).toBe(4)
    expect(recoveryStep([5000, 1000, 3000], 6000).action).toEqual({ kind: 'ask' })
  })
})

class FakeWin extends EventEmitter {
  destroyed = false
  webContents = Object.assign(new EventEmitter(), {
    destroyed: false,
    isDestroyed: () => false,
    isCrashed: () => false,
    isLoading: () => false,
    send: vi.fn(),
  })
  isDestroyed = () => this.destroyed
  asWindow = () => this as unknown as BrowserWindow
}

function setup(prompt?: CrashDeps['prompt']) {
  const win = new FakeWin()
  const deps = { load: vi.fn(() => Promise.resolve()), openLogs: vi.fn(), quit: vi.fn(), prompt }
  const watch = watchCrashes(win.asWindow(), deps)
  const wc = win.webContents
  const crash = (reason = 'crashed') => wc.emit('render-process-gone', {}, { reason, exitCode: 1 })
  return { win, wc, deps, crash, watch, contents: wc as unknown as Parameters<typeof canSend>[0] }
}

describe('watchCrashes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    lines.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('clean-exit 不处理', () => {
    const t = setup()
    t.crash('clean-exit')
    vi.advanceTimersByTime(10_000)
    expect(t.deps.load).not.toHaveBeenCalled()
    expect(canSend(t.contents)).toBe(true)
  })

  it('崩溃后标上恢复中，隔 1 / 2 / 5 秒带 recovered 和 n 重新加载', () => {
    const t = setup()
    t.crash('oom')
    expect(canSend(t.contents)).toBe(false)
    vi.advanceTimersByTime(999)
    expect(t.deps.load).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'oom', n: '1' })
    t.crash('oom')
    vi.advanceTimersByTime(2000)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'oom', n: '2' })
    t.crash('crashed')
    vi.advanceTimersByTime(5000)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'crashed', n: '3' })
    expect(lines.filter(l => l.message === '界面自动重新加载').map(l => l.fields)).toEqual([
      { reason: 'oom', n: 1, delayMs: 1000 },
      { reason: 'oom', n: 2, delayMs: 2000 },
      { reason: 'crashed', n: 3, delayMs: 5000 },
    ])
  })

  it('界面组件崩溃（react-crash）：和真崩溃同一个 10 分钟窗口里计数，带 recovered=react-crash 重新加载', () => {
    const t = setup()
    t.crash('oom')
    vi.advanceTimersByTime(1000)
    t.watch.failed('react-crash')
    expect(canSend(t.contents)).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'react-crash', n: '2' })
    expect(lines.filter(l => l.message === '界面自动重新加载').map(l => l.fields)).toEqual([
      { reason: 'oom', n: 1, delayMs: 1000 },
      { reason: 'react-crash', n: 2, delayMs: 2000 },
    ])
  })

  it('界面组件崩溃第 4 次弹对话框，原因是 react-crash', async () => {
    const prompt = vi.fn<NonNullable<CrashDeps['prompt']>>().mockResolvedValue('reload')
    const t = setup(prompt)
    for (let i = 0; i < 3; i++) {
      t.crash()
      vi.advanceTimersByTime(5000)
    }
    t.watch.failed('react-crash')
    await vi.advanceTimersByTimeAsync(0)
    expect(prompt.mock.calls[0][1]).toMatchObject({ reason: 'react-crash', n: 4 })
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'react-crash', n: '4' })
  })

  it('等待重新加载时窗口关了就不加载', () => {
    const t = setup()
    t.crash()
    t.win.destroyed = true
    t.win.emit('closed')
    vi.advanceTimersByTime(10_000)
    expect(t.deps.load).not.toHaveBeenCalled()
  })

  it('第 4 次弹对话框：打开日志后再弹一次，选重新加载才加载', async () => {
    const prompt = vi
      .fn<NonNullable<CrashDeps['prompt']>>()
      .mockResolvedValueOnce('logs')
      .mockResolvedValueOnce('reload')
    const t = setup(prompt)
    for (let i = 0; i < 3; i++) {
      t.crash()
      vi.advanceTimersByTime(5000)
    }
    expect(prompt).not.toHaveBeenCalled()
    t.crash()
    await vi.advanceTimersByTimeAsync(0)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[0][1]).toMatchObject({ reason: 'crashed', n: 4 })
    expect(t.deps.openLogs).toHaveBeenCalledTimes(1)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'crashed', n: '4' })
    expect(lines.some(l => l.message === '界面反复退出，等用户选择')).toBe(true)
  })

  it('选退出就退出，不加载', async () => {
    const t = setup(vi.fn().mockResolvedValue('quit'))
    for (let i = 0; i < 4; i++) {
      t.crash()
      await vi.advanceTimersByTimeAsync(5000)
    }
    expect(t.deps.quit).toHaveBeenCalledTimes(1)
    expect(t.deps.load).toHaveBeenCalledTimes(3)
  })

  it('恢复中主框架加载失败算一次崩溃，按延时重试；-3 和子框架不算', () => {
    const t = setup()
    t.crash()
    vi.advanceTimersByTime(1000)
    expect(t.deps.load).toHaveBeenCalledTimes(1)
    t.wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'x', true)
    t.wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'x', false)
    vi.advanceTimersByTime(10_000)
    expect(t.deps.load).toHaveBeenCalledTimes(1)
    t.wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'x', true)
    expect(lines.some(l => l.level === 'warn' && l.message === '界面重新加载失败')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'load-failed', n: '2' })
    // 失败期间一直保持恢复中，报到后才结束
    expect(canSend(t.contents)).toBe(false)
    markReady(t.contents)
    expect(canSend(t.contents)).toBe(true)
  })

  it('重新加载既不完成也不失败：超时算一次失败，按延时重试', () => {
    const t = setup()
    t.crash()
    vi.advanceTimersByTime(1000)
    expect(t.deps.load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1)
    expect(t.deps.load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(lines.some(l => l.level === 'warn' && l.message === '界面重新加载超时')).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'load-timeout', n: '2' })
  })

  it('重新加载完成后超时计时作废', () => {
    const t = setup()
    t.crash()
    vi.advanceTimersByTime(1000)
    t.wc.emit('did-finish-load')
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 2)
    expect(t.deps.load).toHaveBeenCalledTimes(1)
  })

  it('对话框开着时又崩：选重新加载用最新的 n 和 reason', async () => {
    let choose: (c: 'reload') => void = () => undefined
    const prompt = vi.fn(() => new Promise<'reload'>(resolve => (choose = resolve)))
    const t = setup(prompt)
    for (let i = 0; i < 3; i++) {
      t.crash()
      vi.advanceTimersByTime(5000)
    }
    t.crash('crashed')
    await vi.advanceTimersByTimeAsync(0)
    t.crash('oom')
    choose('reload')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.deps.load).toHaveBeenLastCalledWith(t.win, { recovered: 'oom', n: '5' })
  })

  it('第一次启动时的加载失败只记日志，不重试', () => {
    const t = setup()
    t.wc.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'x', true)
    vi.advanceTimersByTime(10_000)
    expect(t.deps.load).not.toHaveBeenCalled()
    expect(canSend(t.contents)).toBe(true)
    expect(lines).toEqual([{ level: 'warn', message: '界面加载失败', fields: expect.any(Object) }])
  })
})

describe('loadApp', () => {
  const rejecting = () => ({
    loadURL: vi.fn(() => Promise.reject(new Error('ERR_CONNECTION_REFUSED'))),
    loadFile: vi.fn(() => Promise.reject(new Error('ENOENT'))),
  })

  it('开发模式把查询参数接在地址后面，打包后走 loadFile 的 query', async () => {
    const win = rejecting()
    await loadApp(
      win as unknown as BrowserWindow,
      { devUrl: 'http://localhost:5173', file: 'index.html' },
      { recovered: 'oom', n: '1' },
    )
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173?recovered=oom&n=1')
    await loadApp(win as unknown as BrowserWindow, { file: 'index.html' }, { recovered: 'oom', n: '2' })
    expect(win.loadFile).toHaveBeenCalledWith('index.html', { query: { recovered: 'oom', n: '2' } })
    await loadApp(win as unknown as BrowserWindow, { file: 'index.html' })
    expect(win.loadFile).toHaveBeenLastCalledWith('index.html', undefined)
  })

  it('加载的 rejection 被吞掉', async () => {
    const win = rejecting()
    await expect(loadApp(win as unknown as BrowserWindow, { devUrl: 'http://x', file: 'f' })).resolves.toBeUndefined()
    await expect(loadApp(win as unknown as BrowserWindow, { file: 'f' })).resolves.toBeUndefined()
  })
})
