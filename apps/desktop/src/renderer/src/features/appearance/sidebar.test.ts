import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SIDEBAR_ICONS,
  HEADER_ACTIONS,
  LAYOUT_ACTIONS,
  SIDEBAR_ACTIONS,
  getLayoutIcon,
  getSidebarIcon,
} from './sidebarIcons'
import {
  DEFAULT_SIDEBAR_LAYOUT,
  isRowFull,
  moveSidebarActionInLayout,
  parseSidebarPrefs,
  SIDEBAR_PREFS_KEY,
  SIDEBAR_ROW_LIMIT,
  type SidebarLayout,
} from './sidebar'
import { searchSettings } from '../settings/searchIndex'
import { setCurrentLocale } from '../../i18n/core'

const H = DEFAULT_SIDEBAR_LAYOUT.header

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  setCurrentLocale('zh-CN')
})

function mockStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
  }
  vi.stubGlobal('localStorage', storage)
  return { storage, data }
}

describe('侧边栏外观偏好', () => {
  it('旧默认工具组自动换序，自定义布局保留，新版可再次自定义成旧顺序', () => {
    const oldLayout = { top: ['addProject', 'newTask'], bottom: ['settings', 'plugins', 'usage'] }
    const oldPrefs = {
      version: 2,
      layout: oldLayout,
      showRecent: false,
      recentExpanded: false,
      icons: { usage: 'gauge' },
    }
    const migrated = parseSidebarPrefs(oldPrefs)
    expect(migrated).toMatchObject({
      version: 4,
      layout: { header: H, top: ['addProject', 'newTask'], bottom: ['usage', 'plugins', 'settings'] },
      showRecent: false,
      recentExpanded: false,
      icons: { usage: 'gauge' },
    })
    const custom = { top: ['usage', 'addProject', 'newTask'], bottom: ['settings', 'plugins'] }
    expect(parseSidebarPrefs({ ...oldPrefs, layout: custom }).layout).toEqual({ header: H, ...custom })
    expect(parseSidebarPrefs({ ...oldPrefs, version: 3 }).layout).toEqual({ header: H, ...oldLayout })
  })

  it('默认显示并展开最近任务，无法识别的版本和损坏内容安全回退', () => {
    const fallback = {
      version: 4,
      showRecent: true,
      recentExpanded: true,
      icons: DEFAULT_SIDEBAR_ICONS,
      layout: DEFAULT_SIDEBAR_LAYOUT,
    }
    for (const value of [null, undefined, 1, [], 'invalid', {}, { version: 5, showRecent: false }]) {
      expect(parseSidebarPrefs(value)).toEqual(fallback)
    }
    expect(parseSidebarPrefs({ version: 1, showRecent: 'false', recentExpanded: 0, icons: [] })).toEqual(fallback)
  })

  it('缺失、未知或属于其他动作的图标按项回退，不抹掉有效选择', () => {
    const prefs = parseSidebarPrefs({
      version: 1,
      showRecent: false,
      recentExpanded: false,
      icons: {
        newTask: 'pen-line',
        addProject: 'missing',
        settings: 'puzzle',
        usage: '__proto__',
      },
    })
    expect(prefs).toEqual({
      version: 4,
      showRecent: false,
      recentExpanded: false,
      layout: DEFAULT_SIDEBAR_LAYOUT,
      icons: {
        ...DEFAULT_SIDEBAR_ICONS,
        newTask: 'pen-line',
      },
    })
    expect(getSidebarIcon('usage', { ...prefs.icons, usage: 'missing' as never })).toBe(
      getSidebarIcon('usage', DEFAULT_SIDEBAR_ICONS),
    )
  })

  it('v1 自动采用默认位置并保留已有图标和历史选择，下次修改保存 v4', async () => {
    const { data } = mockStorage({
      [SIDEBAR_PREFS_KEY]: JSON.stringify({
        version: 1,
        showRecent: false,
        recentExpanded: false,
        icons: { ...DEFAULT_SIDEBAR_ICONS, settings: 'bolt', newTask: 'plus' },
        layout: { top: ['usage'], bottom: [] },
      }),
    })
    vi.resetModules()
    const sidebar = await import('./sidebar')
    expect(sidebar.getSidebarPrefs()).toEqual({
      version: 4,
      showRecent: false,
      recentExpanded: false,
      icons: { ...DEFAULT_SIDEBAR_ICONS, settings: 'bolt', newTask: 'plus' },
      layout: DEFAULT_SIDEBAR_LAYOUT,
    })
    sidebar.moveSidebarAction('settings', 'top', 0)
    expect(JSON.parse(data.get(SIDEBAR_PREFS_KEY)!)).toEqual(sidebar.getSidebarPrefs())
    expect(sidebar.getSidebarPrefs().layout.top).toEqual(['settings', 'addProject', 'newTask'])
  })

  it('损坏布局保留合法顺序、跨排去重，并按默认排补齐缺失入口', () => {
    const prefs = parseSidebarPrefs({
      version: 3,
      layout: {
        top: ['usage', 'usage', 'unknown', null, '__proto__', 'newTask'],
        bottom: ['usage', 'settings', 'settings', 0],
      },
    })
    expect(prefs.layout).toEqual({
      header: H,
      top: ['usage', 'newTask', 'addProject'],
      bottom: ['settings', 'plugins'],
    })
    expect(parseSidebarPrefs({ version: 3, layout: { top: 'settings', bottom: ['newTask'] } }).layout).toEqual({
      header: H,
      top: ['addProject'],
      bottom: ['newTask', 'usage', 'plugins', 'settings'],
    })
    for (const layout of [null, [], {}, 'broken', { top: [], bottom: [] }]) {
      expect(parseSidebarPrefs({ version: 3, layout }).layout).toEqual(DEFAULT_SIDEBAR_LAYOUT)
    }
  })

  it('同排移动以移除原位置后的索引插入，跨排移动保留其他图标顺序', () => {
    const layout = structuredClone(DEFAULT_SIDEBAR_LAYOUT)
    expect(moveSidebarActionInLayout(layout, 'settings', 'bottom', 2)).toEqual({
      header: H,
      top: ['addProject', 'newTask'],
      bottom: ['usage', 'plugins', 'settings'],
    })
    expect(moveSidebarActionInLayout(layout, 'usage', 'bottom', 0)).toEqual({
      header: H,
      top: ['addProject', 'newTask'],
      bottom: ['usage', 'plugins', 'settings'],
    })
    expect(moveSidebarActionInLayout(layout, 'plugins', 'top', 1)).toEqual({
      header: H,
      top: ['addProject', 'plugins', 'newTask'],
      bottom: ['usage', 'settings'],
    })
    expect(moveSidebarActionInLayout(layout, 'newTask', 'top', 1)).toEqual(layout)
    expect(layout).toEqual(DEFAULT_SIDEBAR_LAYOUT)
  })

  it('允许所有入口在同一排，空目标排和越界索引不丢失任何入口', () => {
    let layout = structuredClone(DEFAULT_SIDEBAR_LAYOUT)
    for (const action of ['settings', 'plugins', 'usage'] as const) {
      layout = moveSidebarActionInLayout(layout, action, 'top', Number.POSITIVE_INFINITY)
    }
    expect(layout).toEqual({ header: H, top: ['addProject', 'newTask', 'settings', 'plugins', 'usage'], bottom: [] })
    layout = moveSidebarActionInLayout(layout, 'newTask', 'bottom', 999)
    expect(layout.bottom).toEqual(['newTask'])
    layout = moveSidebarActionInLayout(layout, 'settings', 'bottom', -99)
    expect(layout.bottom).toEqual(['settings', 'newTask'])
    for (const row of ['top', 'bottom'] as const) {
      for (const action of SIDEBAR_ACTIONS) {
        for (const index of [-1, 0, 1, 99, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
          const moved = moveSidebarActionInLayout(layout, action, row, index)
          expect([...moved.header, ...moved.top, ...moved.bottom].sort()).toEqual([...LAYOUT_ACTIONS].sort())
          expect(moved[row]).toContain(action)
        }
      }
    }
  })

  it('折叠、隐藏、图标和布局选择重启后保留，恢复显示不改变折叠选择', async () => {
    const { data } = mockStorage({ 'pixelsky.fonts': '{"scale":1.3}' })
    vi.resetModules()
    let sidebar = await import('./sidebar')
    sidebar.setSidebarPrefs({ showRecent: false, recentExpanded: false })
    sidebar.setSidebarIcon('newTask', 'plus')
    sidebar.setSidebarLayout({ header: H, top: ['settings'], bottom: ['newTask', 'usage', 'plugins', 'addProject'] })
    vi.resetModules()
    sidebar = await import('./sidebar')
    expect(sidebar.getSidebarPrefs()).toMatchObject({
      showRecent: false,
      recentExpanded: false,
      icons: { newTask: 'plus' },
      layout: { top: ['settings'], bottom: ['newTask', 'usage', 'plugins', 'addProject'] },
    })
    sidebar.setSidebarPrefs({ showRecent: true })
    expect(sidebar.getSidebarPrefs().recentExpanded).toBe(false)
    expect(data.get('pixelsky.fonts')).toBe('{"scale":1.3}')
    expect(JSON.parse(data.get(SIDEBAR_PREFS_KEY)!)).toEqual(sidebar.getSidebarPrefs())
  })

  it('恢复默认图标保留布局和历史状态，恢复默认位置保留图标和历史状态', async () => {
    mockStorage()
    vi.resetModules()
    const sidebar = await import('./sidebar')
    sidebar.setSidebarPrefs({ showRecent: false, recentExpanded: false })
    sidebar.setSidebarIcon('plugins', 'plug')
    sidebar.setSidebarIcon('usage', 'gauge')
    sidebar.moveSidebarAction('usage', 'top', 0)
    const movedLayout = { header: H, top: ['usage', 'addProject', 'newTask'], bottom: ['plugins', 'settings'] }
    sidebar.resetSidebarIcons()
    expect(sidebar.getSidebarPrefs()).toEqual({
      version: 4,
      showRecent: false,
      recentExpanded: false,
      icons: DEFAULT_SIDEBAR_ICONS,
      layout: movedLayout,
    })
    sidebar.setSidebarIcon('plugins', 'plug')
    sidebar.resetSidebarLayout()
    expect(sidebar.getSidebarPrefs()).toEqual({
      version: 4,
      showRecent: false,
      recentExpanded: false,
      icons: { ...DEFAULT_SIDEBAR_ICONS, plugins: 'plug' },
      layout: DEFAULT_SIDEBAR_LAYOUT,
    })
    vi.resetModules()
    expect((await import('./sidebar')).getSidebarPrefs()).toEqual(sidebar.getSidebarPrefs())
  })

  it('存储读取失败或 JSON 损坏时能启动，写入失败时仍可切换和恢复', async () => {
    const { storage } = mockStorage({ [SIDEBAR_PREFS_KEY]: '{broken' })
    vi.resetModules()
    const sidebar = await import('./sidebar')
    expect(sidebar.getSidebarPrefs().icons).toEqual(DEFAULT_SIDEBAR_ICONS)
    storage.getItem.mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    expect(sidebar.readSidebarPrefs().showRecent).toBe(true)
    storage.setItem.mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    expect(() => sidebar.setSidebarPrefs({ showRecent: false })).not.toThrow()
    sidebar.setSidebarIcon('settings', 'bolt')
    sidebar.moveSidebarAction('usage', 'top', 0)
    expect(sidebar.getSidebarPrefs()).toMatchObject({ showRecent: false, icons: { settings: 'bolt' } })
    expect(sidebar.getSidebarPrefs().layout.top).toEqual(['usage', 'addProject', 'newTask'])
    sidebar.resetSidebarIcons()
    sidebar.resetSidebarLayout()
    expect(sidebar.getSidebarPrefs()).toMatchObject({ showRecent: false, icons: DEFAULT_SIDEBAR_ICONS })
    expect(sidebar.getSidebarPrefs().layout).toEqual(DEFAULT_SIDEBAR_LAYOUT)
  })

  it('调用者修改输入或移动结果不改变已保存布局，损坏运行时布局也会修复', async () => {
    mockStorage()
    vi.resetModules()
    const sidebar = await import('./sidebar')
    const layout: SidebarLayout = {
      header: [...H],
      top: ['usage'],
      bottom: ['settings', 'newTask', 'plugins', 'addProject'],
    }
    sidebar.setSidebarLayout(layout)
    layout.top.length = 0
    expect(sidebar.getSidebarPrefs().layout.top).toEqual(['usage'])
    const preview = sidebar.moveSidebarActionInLayout(sidebar.getSidebarPrefs().layout, 'usage', 'bottom', 0)
    preview.bottom.length = 0
    expect(sidebar.getSidebarPrefs().layout.top).toEqual(['usage'])
    sidebar.setSidebarLayout({ top: ['usage', 'usage'], bottom: ['unknown'] } as unknown as SidebarLayout)
    expect(sidebar.getSidebarPrefs().layout).toEqual({
      header: H,
      top: ['usage', 'addProject', 'newTask'],
      bottom: ['plugins', 'settings'],
    })
  })

  it('损坏的运行时图标输入也会按动作回退', async () => {
    mockStorage()
    vi.resetModules()
    const sidebar = await import('./sidebar')
    sidebar.setSidebarIcon('newTask', 'puzzle')
    expect(sidebar.getSidebarPrefs().icons.newTask).toBe(DEFAULT_SIDEBAR_ICONS.newTask)
    sidebar.setSidebarIcon('addProject', 'folder-open')
    expect(sidebar.getSidebarPrefs().icons.addProject).toBe('folder-open')
  })

  it('v3 升级到 v4 时补上默认顶栏排，保留自定义侧栏顺序', () => {
    const custom = { top: ['settings', 'newTask'], bottom: ['addProject', 'usage', 'plugins'] }
    const prefs = parseSidebarPrefs({ version: 3, showRecent: true, recentExpanded: true, layout: custom })
    expect(prefs).toMatchObject({ version: 4, layout: { header: H, ...custom } })
    expect(H).toEqual([...HEADER_ACTIONS])
  })

  it('顶栏工具与侧栏动作可在三排之间互相移动，图标随入口走', () => {
    let layout = moveSidebarActionInLayout(DEFAULT_SIDEBAR_LAYOUT, 'git', 'bottom', 0)
    expect(layout.header).not.toContain('git')
    expect(layout.bottom).toEqual(['git', 'usage', 'plugins', 'settings'])
    layout = moveSidebarActionInLayout(layout, 'usage', 'header', 0)
    expect(layout.header[0]).toBe('usage')
    expect(layout.bottom).toEqual(['git', 'plugins', 'settings'])
    layout = moveSidebarActionInLayout(layout, 'channels', 'top', 99)
    expect(layout.top).toEqual(['addProject', 'newTask', 'channels'])
    expect(getLayoutIcon('usage', DEFAULT_SIDEBAR_ICONS)).toBe(getSidebarIcon('usage', DEFAULT_SIDEBAR_ICONS))
    expect(getLayoutIcon('git', DEFAULT_SIDEBAR_ICONS)).toBeTruthy()
    // 顶栏工具放进侧栏后照样受每排上限约束；机器切换和右面板开关固定，不在布局里
    for (const action of ['machines', 'workbench'] as const)
      layout = moveSidebarActionInLayout(layout, action, 'top', 99)
    expect(layout.top).toEqual(['addProject', 'newTask', 'channels', 'machines', 'workbench'])
    expect(moveSidebarActionInLayout(layout, 'usage', 'top', 0)).toEqual(layout)
    expect(layout.header).toEqual(['usage', 'openIn'])
  })

  it('侧栏一排最多 5 个，排满时拒绝移入但允许排内换序；顶栏不限', () => {
    let layout = DEFAULT_SIDEBAR_LAYOUT
    for (const action of ['workbench', 'machines', 'channels'] as const)
      layout = moveSidebarActionInLayout(layout, action, 'top', 99)
    expect(layout.top).toHaveLength(SIDEBAR_ROW_LIMIT)
    expect(isRowFull(layout, 'top')).toBe(true)
    expect(isRowFull(layout, 'top', 'newTask')).toBe(false)
    expect(moveSidebarActionInLayout(layout, 'settings', 'top', 0)).toEqual(layout)
    expect(moveSidebarActionInLayout(layout, 'newTask', 'top', 0).top[0]).toBe('newTask')
    for (const action of SIDEBAR_ACTIONS) layout = moveSidebarActionInLayout(layout, action, 'header', 0)
    expect(layout.header).toHaveLength(LAYOUT_ACTIONS.length - layout.top.length)
    expect(isRowFull(layout, 'header')).toBe(false)
  })

  it('旧偏好里没有「打开方式」（GitHub #12）：读取时补到顶栏最后', () => {
    const prefs = parseSidebarPrefs({
      version: 4,
      layout: {
        header: ['git', 'workbench'],
        top: ['addProject', 'newTask'],
        bottom: ['usage', 'plugins', 'settings'],
      },
    })
    expect(prefs.layout.header).toEqual(['git', 'workbench', 'machines', 'channels', 'openIn'])
  })

  it('终端、编辑器、命令面板已从图标位置移除（D066），旧偏好里的位置读取时丢弃', () => {
    const prefs = parseSidebarPrefs({
      version: 4,
      layout: {
        header: ['terminal', 'editor', 'commandPalette', 'workbench'],
        top: ['commandPalette', 'newTask'],
        bottom: ['editor', 'usage'],
      },
    })
    const all = [...prefs.layout.header, ...prefs.layout.top, ...prefs.layout.bottom]
    for (const gone of ['terminal', 'editor', 'commandPalette']) expect(all).not.toContain(gone)
    expect(prefs.layout.header[0]).toBe('workbench')
    expect(prefs.layout.top.slice(0, 1)).toEqual(['newTask'])
    expect(all.sort()).toEqual([...LAYOUT_ACTIONS].sort())
    expect(DEFAULT_SIDEBAR_LAYOUT.header).toEqual(['workbench', 'machines', 'channels', 'git', 'openIn'])
  })

  it('旧偏好里的自动化原位换成 Git（D061），不重复、不丢位置', () => {
    const prefs = parseSidebarPrefs({
      version: 4,
      layout: { header: ['terminal', 'workbench'], top: ['automation', 'newTask'], bottom: ['usage'] },
    })
    expect(prefs.layout.top.slice(0, 2)).toEqual(['git', 'newTask'])
    const all = [...prefs.layout.header, ...prefs.layout.top, ...prefs.layout.bottom]
    expect(all.filter(a => a === 'git')).toHaveLength(1)
    expect(all).not.toContain('automation')
    expect(
      parseSidebarPrefs({ version: 4, layout: { header: ['automation', 'git'] } }).layout.header.slice(0, 1),
    ).toEqual(['git'])
  })

  it('损坏数据里超出上限的侧栏入口溢出到顶栏，不丢入口', () => {
    const prefs = parseSidebarPrefs({ version: 4, layout: { header: [], top: [...LAYOUT_ACTIONS], bottom: [] } })
    expect(prefs.layout.top).toEqual(LAYOUT_ACTIONS.slice(0, SIDEBAR_ROW_LIMIT))
    expect([...prefs.layout.header, ...prefs.layout.top, ...prefs.layout.bottom].sort()).toEqual(
      [...LAYOUT_ACTIONS].sort(),
    )
    expect(prefs.layout.bottom).toEqual([])
  })

  it('恢复默认位置同时恢复顶栏排', async () => {
    mockStorage()
    vi.resetModules()
    const sidebar = await import('./sidebar')
    sidebar.moveSidebarAction('git', 'bottom', 0)
    sidebar.moveSidebarAction('settings', 'header', 0)
    expect(sidebar.getSidebarPrefs().layout.header[0]).toBe('settings')
    sidebar.resetSidebarLayout()
    expect(sidebar.getSidebarPrefs().layout).toEqual(DEFAULT_SIDEBAR_LAYOUT)
  })

  it('中英文历史、侧栏和图标搜索都定位到外观设置', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      setCurrentLocale(locale)
      for (const query of ['侧边栏', '历史', '最近任务', 'sidebar', 'history', 'recent']) {
        expect(
          searchSettings(query, s => s).some(
            e => e.section === 'appearance' && ['侧边栏', '显示最近任务'].includes(e.title),
          ),
        ).toBe(true)
      }
      for (const query of ['顶栏', '右上角', 'toolbar', 'top bar']) {
        expect(searchSettings(query, s => s).some(e => e.section === 'appearance' && e.title === '图标位置')).toBe(true)
      }
      for (const query of ['图标', '自定义', '替换', 'icons', 'customize', 'reset']) {
        expect(searchSettings(query, s => s).some(e => e.section === 'appearance' && e.title === '侧边栏图标')).toBe(
          true,
        )
      }
    }
  })
})
