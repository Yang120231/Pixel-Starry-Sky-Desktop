import { describe, expect, it } from 'vitest'
import { activatePanelTab, parsePanel, panelCloseTargets, removePanelTabs } from './workspaceState'
import { fileTab } from '../../panes/tree'

describe('right workspace resource layout', () => {
  const file = fileTab({ projectId: 'project-a' }, 'src/main.ts')
  it('restores valid resources and recovers from a removed active tab', () => {
    expect(parsePanel({ tabs: ['files', null, 'unknown-tool', file, file], active: 'unknown-tool' })).toEqual({
      tabs: ['files', file],
      active: 'files',
    })
    expect(parsePanel({ tabs: [], active: null })).toEqual({ tabs: [], active: null })
  })
  it('reopening the same file activates its existing tab', () => {
    const layout = { tabs: [file, 'terminal', 'browser'], active: 'browser' }
    expect(activatePanelTab(layout, file)).toEqual({ ...layout, active: file })
  })
  it('batch close targets are calculated before confirmation and preserve the selected tab', () => {
    const layout = { tabs: ['files', file, 'terminal', 'browser'], active: file }
    const targets = panelCloseTargets(layout, file, 'right')
    expect(targets).toEqual(['terminal', 'browser'])
    expect(removePanelTabs(layout, targets)).toEqual({ tabs: ['files', file], active: file })
    expect(removePanelTabs(layout, [file])).toEqual({ tabs: ['files', 'terminal', 'browser'], active: 'terminal' })
    expect(panelCloseTargets(layout, 'missing', 'all')).toEqual([])
  })
})
