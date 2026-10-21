import { describe, expect, it, vi } from 'vitest'
import type { SessionState, SessionSummary } from '@pixelsky/protocol'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, Menu: {}, Tray: class {}, nativeImage: {}, dialog: {} }))
vi.mock('../ipc/guard', () => ({ handle: () => {}, on: () => {} }))

const { TRAY_LIST_MAX, parseTrayPrefs, trayIcon, trayMenu, trayStatus, trayText, trayTooltip } = await import('./tray')

const session = (id: string, state: SessionState, extra: Partial<SessionSummary['record']> = {}): SessionSummary =>
  ({ record: { id, title: `任务 ${id}`, archivedAt: null, ...extra }, state }) as SessionSummary

const zh = trayText('zh-CN'),
  en = trayText('en-US')
const noop = { show() {}, newTask() {}, open() {}, dnd() {}, checkUpdate() {}, restart() {}, quit() {} }

describe('托盘状态', () => {
  it('运行中含启动中；等你处理单独算；归档的不算', () => {
    const s = trayStatus([
      session('a', 'running'),
      session('b', 'starting'),
      session('c', 'waiting'),
      session('d', 'idle'),
      session('e', 'running', { archivedAt: 1 }),
    ])
    expect(s.running.map(t => t.id)).toEqual(['a', 'b'])
    expect(s.waiting.map(t => t.id)).toEqual(['c'])
  })

  it('等你处理优先显示红点，其次运行中，都没有是普通图标', () => {
    expect(trayIcon({ running: [], waiting: [] })).toBe('tray')
    expect(trayIcon(trayStatus([session('a', 'running')]))).toBe('tray-running')
    expect(trayIcon(trayStatus([session('a', 'running'), session('b', 'waiting')]))).toBe('tray-attention')
  })

  it('悬停提示：空闲只显示名字，有任务时带上数量，跟界面语言', () => {
    expect(trayTooltip({ running: [], waiting: [] }, zh)).toBe('像素星空')
    const s = trayStatus([session('a', 'running'), session('b', 'running'), session('c', 'waiting')])
    expect(trayTooltip(s, zh)).toBe('像素星空 · 2 个任务运行中 · 1 个等你处理')
    expect(trayTooltip(s, en)).toBe('Pixel Starry Sky · 2 running · 1 waiting for you')
  })
})

describe('托盘菜单', () => {
  it('条目齐全；没有任务时两个子菜单是灰的', () => {
    const items = trayMenu({ running: [], waiting: [] }, { t: zh, dndUntil: null, now: 0 }, noop)
    expect(items.filter(i => i.label).map(i => i.label)).toEqual([
      '显示像素星空',
      '新建任务',
      '运行中（0）',
      '等你处理（0）',
      '勿扰 1 小时',
      '检查更新…',
      '重启像素星空',
      '退出像素星空',
    ])
    expect(items.find(i => i.label === '运行中（0）')?.enabled).toBe(false)
  })

  it('重启和退出各走各的：点「重启像素星空」只调 restart', () => {
    const restart = vi.fn()
    const quit = vi.fn()
    const items = trayMenu({ running: [], waiting: [] }, { t: en, dndUntil: null, now: 0 }, { ...noop, restart, quit })
    items.find(i => i.label === 'Restart Pixel Starry Sky')!.click!({} as never, undefined, {} as never)
    expect(restart).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()
    // 开发模式（electron-vite 的开发服务）重开不了：灰掉
    const dev = trayMenu({ running: [], waiting: [] }, { t: zh, dndUntil: null, now: 0, canRestart: false }, noop)
    expect(dev.find(i => i.label === '重启像素星空')?.enabled).toBe(false)
  })

  it('会话列表最多 5 个，多的显示「还有 N 个」；点了打开那个会话；& 转义', () => {
    const open = vi.fn()
    const many = Array.from({ length: 7 }, (_, i) => session(String(i), 'running', { title: i === 0 ? 'A & B' : '' }))
    const items = trayMenu(trayStatus(many), { t: zh, dndUntil: null, now: 0 }, { ...noop, open })
    const sub = items.find(i => i.label === '运行中（7）')!.submenu as Array<{ label: string; click?: () => void }>
    expect(sub).toHaveLength(TRAY_LIST_MAX + 1)
    expect(sub[0].label).toBe('A && B')
    expect(sub[1].label).toBe('未命名任务')
    expect(sub.at(-1)!.label).toBe('还有 2 个…')
    sub[3].click!()
    expect(open).toHaveBeenCalledWith('3')
  })

  it('勿扰：没开时「勿扰 1 小时」，开着（没到期）时「结束勿扰」', () => {
    const dnd = vi.fn()
    const now = 1_000_000
    const off = trayMenu({ running: [], waiting: [] }, { t: zh, dndUntil: null, now }, { ...noop, dnd })
    off.find(i => i.label === '勿扰 1 小时')!.click!({} as never, undefined, {} as never)
    expect(dnd).toHaveBeenCalledWith(now + 3_600_000)
    const on = trayMenu({ running: [], waiting: [] }, { t: zh, dndUntil: now + 10, now }, { ...noop, dnd })
    on.find(i => i.label === '结束勿扰')!.click!({} as never, undefined, {} as never)
    expect(dnd).toHaveBeenLastCalledWith(null)
    // 已经到期的当作没开
    expect(
      trayMenu({ running: [], waiting: [] }, { t: zh, dndUntil: now - 1, now }, noop).some(
        i => i.label === '勿扰 1 小时',
      ),
    ).toBe(true)
  })
})

describe('窗口偏好', () => {
  it('默认隐藏到托盘；损坏的值回到默认', () => {
    expect(parseTrayPrefs(null)).toEqual({ closeToTray: true, hintShown: false })
    expect(parseTrayPrefs({ closeToTray: 'no', hintShown: 1 })).toEqual({ closeToTray: true, hintShown: false })
    expect(parseTrayPrefs({ closeToTray: false, hintShown: true })).toEqual({ closeToTray: false, hintShown: true })
  })
})
