import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, PALETTES, parsePalette } from './palette'
import { searchSettings } from '../settings/searchIndex'

const tokens = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8')

/** 取出某个选择器那一块里的全部变量 */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}
const light = (p: string) => block(`[data-palette-preview='${p}'] {`)
const dark = (p: string) => block(`:root[data-theme='dark'] [data-palette-preview='${p}'] {`)

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

// 每套配色都要给的变量：少一个就会漏出默认暖灰
const REQUIRED = [
  '--ink',
  '--bg-rail',
  '--bg-sidebar',
  '--bg-app',
  '--bg-panel',
  '--bg-surface',
  '--bg-popover',
  '--bg-workbench',
  '--border',
  '--border-subtle',
  '--border-strong',
  '--text',
  '--text-secondary',
  '--text-muted',
  '--text-faint',
  '--text-body',
  '--theme-accent',
  '--theme-accent-on',
  '--theme-accent-soft',
  '--theme-accent-text',
  '--theme-accent-border',
  '--btn-primary-bg',
  '--btn-primary-text',
  '--btn-disabled-bg',
  '--btn-disabled-text',
  '--engine-chip-bg',
  '--engine-chip-text',
  '--wall-tint',
  '--wall-sidebar',
  '--wall-surface',
  '--terminal-bg',
  '--terminal-fg',
  '--terminal-cursor',
  '--terminal-selection',
].sort()

describe('配色主题', () => {
  it('缺失、旧值或损坏类型回到默认暖灰，有效值原样保留', () => {
    for (const value of [undefined, null, '', 'dracula', {}, 1]) expect(parsePalette(value)).toBe(DEFAULT_PALETTE)
    for (const value of PALETTES) expect(parsePalette(value)).toBe(value)
  })

  it('每套配色的浅色和深色都定义了同一组变量，且两份不一样', () => {
    for (const p of PALETTES.filter(p => p !== DEFAULT_PALETTE)) {
      expect(Object.keys(light(p)).sort(), `${p} 浅色`).toEqual(REQUIRED)
      expect(Object.keys(dark(p)).sort(), `${p} 深色`).toEqual(REQUIRED)
      expect(light(p), p).not.toEqual(dark(p))
    }
    // 默认暖灰的基础块也要有这些变量
    for (const vars of [light('default'), dark('default')])
      for (const name of REQUIRED) expect(vars).toHaveProperty(name)
  })

  it('文字、主色、按钮的对比度都过 WCAG AA（4.5:1）', () => {
    for (const p of PALETTES)
      for (const [variant, v] of [
        ['浅色', light(p)],
        ['深色', dark(p)],
      ] as const) {
        const pairs: Array<[string, string]> = [
          ['--text', '--bg-app'],
          ['--text', '--bg-surface'],
          ['--text', '--bg-popover'],
          ['--text-body', '--bg-surface'],
          ['--text-secondary', '--bg-app'],
          ['--theme-accent-text', '--bg-app'],
          ['--theme-accent-text', '--bg-surface'],
          ['--theme-accent-text', '--theme-accent-soft'],
          ['--theme-accent-on', '--theme-accent'],
          ['--btn-primary-text', '--btn-primary-bg'],
          ['--terminal-fg', '--terminal-bg'],
        ]
        for (const [fg, bg] of pairs)
          expect(contrast(v[fg], v[bg]), `${p} ${variant} ${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
  })

  it('壁纸的透明底压得过深色配色（选择器更具体，且写在配色后面）', () => {
    const wallpaper = tokens.indexOf(':root[data-wallpaper][data-theme] {')
    expect(wallpaper).toBeGreaterThan(tokens.lastIndexOf('[data-palette-preview='))
  })

  it('设置搜索能按配色名找到配色主题', () => {
    for (const q of ['配色主题', 'nord', 'solarized', 'Tokyo Night'])
      expect(searchSettings(q, () => '外观').map(e => e.title)).toContain('配色主题')
  })
})
