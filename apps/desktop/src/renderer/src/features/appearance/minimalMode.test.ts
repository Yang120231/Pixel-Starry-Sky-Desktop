import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MINIMAL_MODE, parseMinimalMode } from './minimalMode'
import { searchSettings } from '../settings/searchIndex'

const css = (name: string) => readFileSync(fileURLToPath(new URL(`../../styles/${name}`, import.meta.url)), 'utf8')

describe('极简模式', () => {
  it('默认关，缺失或损坏的值回到关', () => {
    expect(DEFAULT_MINIMAL_MODE).toBe('off')
    for (const value of [undefined, null, '', 'true', 1, {}]) expect(parseMinimalMode(value)).toBe('off')
    expect(parseMinimalMode('on')).toBe('on')
    expect(parseMinimalMode('off')).toBe('off')
  })

  it('样式全部挂在 data-minimal="on" 下，关掉时不影响任何东西', () => {
    const rules = css('minimal.css')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map(rule => rule.split('{')[0].trim())
      .filter(selector => selector && !selector.startsWith('--'))
    expect(rules.length).toBeGreaterThan(5)
    for (const selector of rules)
      for (const part of selector.split(/,(?![^(]*\))/))
        expect(part.trim(), selector).toMatch(/^:root\[data-minimal='on'\]/)
    expect(css('globals.css')).toContain("@import './minimal.css';")
  })

  it('紧凑比例两种模式共用（D137）：density.css 不挂在 data-minimal 下，在 minimal.css 之前引入', () => {
    const density = css('density.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(density).toContain('--density: 0.92')
    expect(density).not.toContain('data-minimal')
    const globals = css('globals.css')
    expect(globals.indexOf("@import './density.css';")).toBeGreaterThan(-1)
    expect(globals.indexOf("@import './density.css';")).toBeLessThan(globals.indexOf("@import './minimal.css';"))
  })

  it('字号变量都乘了 --density', () => {
    const sizes = [...css('globals.css').matchAll(/ {2}--text-[a-z]+: (calc\([^;]+\));/g)].map(m => m[1])
    expect(sizes).toHaveLength(7)
    for (const size of sizes) expect(size).toContain('var(--density, 1)')
  })

  it('设置搜索能找到极简模式，按「极夜」能找到配色主题', () => {
    for (const q of ['极简', 'minimal', 'factory'])
      expect(searchSettings(q, () => '外观').map(e => e.title)).toContain('极简模式')
    expect(searchSettings('极夜', () => '外观').map(e => e.title)).toContain('配色主题')
  })
})
