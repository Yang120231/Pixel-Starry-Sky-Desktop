// 右侧面板的自动宽度（docs/ui/workbench-ux-3.md §2.3）
import { describe, expect, it } from 'vitest'
import { autoPanelWidth } from './panelWidth'

describe('右侧面板自动宽度', () => {
  it('先给对话区留 680px，限制在 360–720', () => {
    expect([1100, 1280, 1440, 1600, 1920, 2560].map(w => autoPanelWidth(w, 290))).toEqual([
      360, 360, 470, 630, 720, 720,
    ])
  })

  it('侧栏拖宽了，面板相应变窄', () => {
    expect(autoPanelWidth(1600, 400)).toBe(520)
  })
})
