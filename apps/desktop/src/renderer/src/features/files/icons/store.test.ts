import { describe, expect, it } from 'vitest'
import type { ExtPackInfo } from '@pixelsky/protocol'
import { fakePack, fakeState } from '@/features/extpacks/testing'
import { effectiveIconChoice, iconThemeOptions, selectIconTheme } from './store'

const material = (over: Partial<ExtPackInfo> = {}) =>
  fakePack({
    key: 'b-1',
    id: 'pixelsky.material-icons',
    source: 'builtin',
    contributes: { iconThemes: [{ id: 'material', label: 'Material', path: 'theme/material-icons.json' }] },
    ...over,
  })
const custom = (over: Partial<ExtPackInfo> = {}) =>
  fakePack({
    key: 'f-2',
    id: 'acme.icons',
    addedAt: 5,
    contributes: {
      iconThemes: [
        { id: 'flat', label: 'Flat', path: 'flat.json' },
        { id: 'extra', label: 'Extra', path: 'extra.json', partial: true },
      ],
    },
    ...over,
  })

describe('selectIconTheme', () => {
  it("'simple' 不用主题", () => {
    expect(selectIconTheme('simple', fakeState(material()))).toBeNull()
  })
  it("'material' 取内置包的主题，并带上所有生效的局部主题", () => {
    const sel = selectIconTheme('material', fakeState(material(), custom()))
    expect(sel?.base.pack.key).toBe('b-1')
    expect(sel?.base.path).toBe('theme/material-icons.json')
    expect(sel?.partials.map(p => p.path)).toEqual(['extra.json'])
  })
  it('选了扩展里的主题就用它（局部主题不能当底板）', () => {
    expect(selectIconTheme('acme.icons/flat', fakeState(material(), custom()))?.base.path).toBe('flat.json')
    expect(selectIconTheme('acme.icons/extra', fakeState(material(), custom()))?.base.path).toBe(
      'theme/material-icons.json',
    )
  })
  it('选的扩展没了或停用了，退回 Material；Material 也停用就退回简单', () => {
    const state = fakeState(material(), custom({ live: false }))
    expect(selectIconTheme('acme.icons/flat', state)?.base.pack.key).toBe('b-1')
    expect(selectIconTheme('material', fakeState(material({ live: false })))).toBeNull()
    expect(selectIconTheme('acme.icons/flat', fakeState())).toBeNull()
  })
  it('被停用的贡献（inactive 下标）不参与', () => {
    const state = fakeState(material({ inactive: { iconThemes: [0] } }))
    expect(selectIconTheme('material', state)).toBeNull()
  })
})

describe('effectiveIconChoice / iconThemeOptions', () => {
  it('显示实际生效的那一项', () => {
    expect(effectiveIconChoice('acme.icons/flat', fakeState(material(), custom()))).toBe('acme.icons/flat')
    expect(effectiveIconChoice('acme.icons/flat', fakeState(material()))).toBe('material')
    expect(effectiveIconChoice('material', fakeState(material({ enabled: false, live: false })))).toBe('simple')
  })
  it('选项：Material、简单，再加扩展里的完整主题（不含局部主题）', () => {
    const options = iconThemeOptions(fakeState(material(), custom()), 'zh-CN')
    expect(options.map(o => o.value)).toEqual(['material', 'simple', 'acme.icons/flat'])
    expect(options[2].label).toContain('Flat')
  })
})
