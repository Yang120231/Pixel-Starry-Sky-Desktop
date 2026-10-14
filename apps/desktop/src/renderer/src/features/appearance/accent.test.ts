import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT, parseAccent } from './accent'
import { searchSettings } from '../settings/searchIndex'

const tokens = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8')
const globals = readFileSync(fileURLToPath(new URL('../../styles/globals.css', import.meta.url)), 'utf8')

const ACCENT_VARS = ['--accent', '--accent-on', '--accent-soft', '--accent-text', '--accent-border']

/** 取出某个选择器那一块里的 --accent* 变量 */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/(--accent[\w-]*):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

describe('强调色预设', () => {
  it('主按钮、发送按钮、进度条和开着的开关都跟着强调色（D138）', () => {
    expect(globals).toContain('--color-primary: var(--accent);')
    expect(globals).toContain('--color-primary-fg: var(--accent-on);')
    const on = globals.slice(globals.indexOf(".ui-switch[aria-checked='true'] {"))
    expect(on.slice(0, on.indexOf('}'))).toContain('background: var(--accent);')
  })

  it('缺失、旧值或损坏类型回到跟随配色，有效值原样保留', () => {
    for (const value of [undefined, null, '', 'red', {}, 1]) expect(parseAccent(value)).toBe(DEFAULT_ACCENT)
    for (const value of ACCENTS) expect(parseAccent(value)).toBe(value)
  })

  it('每一套预设在浅色和深色下都定义了全部强调色变量，色块和整页用同一组值', () => {
    for (const accent of ACCENTS.filter(a => a !== DEFAULT_ACCENT)) {
      const light = block(`[data-accent-swatch='${accent}'] {`)
      const dark = block(`:root[data-theme='dark'] [data-accent-swatch='${accent}'] {`)
      expect(Object.keys(light).sort(), accent).toEqual([...ACCENT_VARS].sort())
      expect(Object.keys(dark).sort(), accent).toEqual([...ACCENT_VARS].sort())
      expect(light, accent).not.toEqual(dark)
    }
    // 跟随配色：--accent* 全部取 --theme-accent*
    expect(block("[data-accent-swatch='theme'] {")).toEqual(
      Object.fromEntries(ACCENT_VARS.map(name => [name, `var(${name.replace('--accent', '--theme-accent')})`])),
    )
  })

  it('第一版保存的墨绿读成跟随配色', () => {
    expect(parseAccent('green')).toBe('theme')
  })

  it('设置搜索能按颜色名找到强调色', () => {
    for (const q of ['强调色', '海蓝', 'accent'])
      expect(searchSettings(q, () => '外观').map(e => e.title)).toContain('强调色')
  })
})
