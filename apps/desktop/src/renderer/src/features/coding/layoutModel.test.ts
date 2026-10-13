import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN_WIDTH,
  DEFAULT_CODING_LAYOUT,
  PANEL_LIMITS,
  clampPanel,
  fitCoding,
  parseAppMode,
  parseCodingLayout,
  toggleBottomTab,
  toggleLeftView,
  toggleRightView,
} from './layoutModel'
import type { CodingLayoutPrefs } from './types'

interface Over {
  l: number
  r: number
  b: number
  lo: boolean
  ro: boolean
  bo: boolean
  max: boolean
}
const prefs = (over: Partial<Over> = {}): CodingLayoutPrefs => ({
  left: { open: over.lo ?? true, size: over.l ?? 280, view: 'files' },
  right: { open: over.ro ?? true, size: over.r ?? 420, view: 'chat' },
  bottom: { open: over.bo ?? true, size: over.b ?? 260, tab: 'terminal', maximized: over.max ?? false },
})

describe('parseAppMode', () => {
  it('只认 code', () => {
    expect(parseAppMode('code')).toBe('code')
    expect(parseAppMode('chat')).toBe('chat')
    expect(parseAppMode(null)).toBe('chat')
    expect(parseAppMode(1)).toBe('chat')
  })
})

describe('clampPanel', () => {
  it('夹到上下限，坏值退回初始', () => {
    expect(clampPanel('left', 10)).toBe(240)
    expect(clampPanel('left', 9999)).toBe(520)
    expect(clampPanel('right', 333.4)).toBe(333)
    expect(clampPanel('bottom', Number.NaN)).toBe(PANEL_LIMITS.bottom.initial)
  })
})

describe('parseCodingLayout', () => {
  it('坏 JSON 和非对象退回默认', () => {
    expect(parseCodingLayout('{oops')).toEqual(DEFAULT_CODING_LAYOUT)
    expect(parseCodingLayout(null)).toEqual(DEFAULT_CODING_LAYOUT)
    expect(parseCodingLayout([1])).toEqual(DEFAULT_CODING_LAYOUT)
  })
  it('逐字段退回默认并夹取', () => {
    const p = parseCodingLayout({
      left: { open: false, size: 5, view: 'nope' },
      right: { open: 'x', size: 500, view: 'browser' },
      bottom: { tab: 'problems', maximized: true, size: 'a' },
    })
    expect(p.left).toEqual({ open: false, size: 240, view: 'files' })
    expect(p.right).toEqual({ open: true, size: 500, view: 'browser' })
    expect(p.bottom).toEqual({ open: true, size: 260, tab: 'problems', maximized: true })
  })
  it('接受 JSON 字符串', () => {
    expect(parseCodingLayout(JSON.stringify(prefs({ l: 300 }))).left.size).toBe(300)
  })
})

describe('fitCoding 宽度', () => {
  const H = { height: 900 }
  it('1920 宽全部放得下', () => {
    const f = fitCoding(prefs(), { width: 1920, ...H })
    expect(f.left).toEqual({ shown: true, size: 280 })
    expect(f.right).toEqual({ shown: true, size: 420 })
    expect(f.centerWidth).toBe(1920 - 80 - 280 - 420)
    expect(f.tooNarrow).toBe(false)
  })
  it('1400 宽放得下', () => {
    const f = fitCoding(prefs(), { width: 1400, ...H })
    expect(f.centerWidth).toBe(1400 - 80 - 700)
    expect(f.left.size).toBe(280)
    expect(f.right.size).toBe(420)
  })
  it('1100 宽先缩右栏，再缩左栏', () => {
    // avail 1020，L+R=700，中栏 320，缺 100：右栏 420 -> 320
    const f = fitCoding(prefs(), { width: 1100, ...H })
    expect(f.right.size).toBe(320)
    expect(f.left.size).toBe(280)
    expect(f.centerWidth).toBe(420)
    // 右栏已经最小再缩左栏
    const g = fitCoding(prefs({ r: 320, l: 400 }), { width: 1100, ...H })
    expect(g.right.size).toBe(320)
    expect(g.left.size).toBe(280)
    expect(g.centerWidth).toBe(CENTER_MIN_WIDTH)
  })
  it('缩不够时藏左栏，仍不够时 tooNarrow', () => {
    const f = fitCoding(prefs(), { width: 1000, ...H }) // avail 920
    expect(f.left.shown).toBe(false)
    expect(f.right.shown).toBe(true)
    expect(f.centerWidth).toBe(920 - 320)
    expect(f.tooNarrow).toBe(false)
    const g = fitCoding(prefs(), { width: 800, ...H }) // avail 720，右栏 320 -> 中栏 400
    expect(g.left.shown).toBe(false)
    expect(g.right.shown).toBe(true)
    expect(g.tooNarrow).toBe(true)
  })
  it('收起的栏不占宽度', () => {
    const f = fitCoding(prefs({ lo: false, ro: false }), { width: 1100, ...H })
    expect(f.left.shown).toBe(false)
    expect(f.right.shown).toBe(false)
    expect(f.centerWidth).toBe(1020)
    expect(f.tooNarrow).toBe(false)
  })
  it('只开左栏或只开右栏', () => {
    expect(fitCoding(prefs({ ro: false }), { width: 1100, ...H }).left.size).toBe(280)
    expect(fitCoding(prefs({ lo: false }), { width: 1100, ...H }).right.size).toBe(420)
    expect(fitCoding(prefs({ ro: false, l: 520 }), { width: 1100, ...H }).left.size).toBe(520)
  })
  it('不改传入的偏好', () => {
    const p = prefs()
    fitCoding(p, { width: 1000, ...H })
    expect(p).toEqual(prefs())
  })
})

describe('fitCoding 底栏', () => {
  const W = { width: 1920 }
  it('正常高度', () => {
    const f = fitCoding(prefs(), { ...W, height: 900 })
    expect(f.bottom).toEqual({ shown: true, size: 260 })
    expect(f.editorHidden).toBe(false)
  })
  it('最大化占满可用高度并藏编辑器', () => {
    const f = fitCoding(prefs({ max: true }), { ...W, height: 900 })
    expect(f.bottom).toEqual({ shown: true, size: 900 - 48 - 24 })
    expect(f.editorHidden).toBe(true)
  })
  it('最大化但没打开时不生效', () => {
    const f = fitCoding(prefs({ max: true, bo: false }), { ...W, height: 900 })
    expect(f.bottom.shown).toBe(false)
    expect(f.editorHidden).toBe(false)
  })
  it('高度不够时给编辑器留 160，缩到不足 120 就藏起来', () => {
    // availH = 700-72 = 628，上限 468
    expect(fitCoding(prefs({ b: 600 }), { ...W, height: 700 }).bottom).toEqual({ shown: true, size: 468 })
    // availH = 300-72 = 228，228-160 = 68 < 120
    expect(fitCoding(prefs(), { ...W, height: 300 }).bottom.shown).toBe(false)
  })
})

describe('开合逻辑', () => {
  it('左栏：当前视图再点收起，别的视图切换并打开', () => {
    const a = toggleLeftView(DEFAULT_CODING_LAYOUT, 'files')
    expect(a.left.open).toBe(false)
    const b = toggleLeftView(a, 'files')
    expect(b.left).toMatchObject({ open: true, view: 'files' })
    const c = toggleLeftView(b, 'git')
    expect(c.left).toMatchObject({ open: true, view: 'git' })
    expect(toggleLeftView({ ...c, left: { ...c.left, open: false } }, 'git').left.open).toBe(true)
  })
  it('右栏同理', () => {
    const a = toggleRightView(DEFAULT_CODING_LAYOUT, 'chat')
    expect(a.right.open).toBe(false)
    expect(toggleRightView(a, 'browser').right).toMatchObject({ open: true, view: 'browser' })
  })
  it('底栏：不传 tab 只开合，传 tab 同左栏规则', () => {
    const a = toggleBottomTab(DEFAULT_CODING_LAYOUT)
    expect(a.bottom).toMatchObject({ open: false, tab: 'terminal' })
    expect(toggleBottomTab(a, 'problems').bottom).toMatchObject({ open: true, tab: 'problems' })
    expect(toggleBottomTab(DEFAULT_CODING_LAYOUT, 'terminal').bottom.open).toBe(false)
    expect(toggleBottomTab(DEFAULT_CODING_LAYOUT, 'ports').bottom).toMatchObject({ open: true, tab: 'ports' })
  })
})
