import { describe, expect, it } from 'vitest'
import { routeWorkspaceTool } from './routingModel'

describe('routeWorkspaceTool', () => {
  it('终端进底栏，git 和文件进左栏', () => {
    expect(routeWorkspaceTool('terminal')).toEqual({ panel: 'bottom', tab: 'terminal' })
    expect(routeWorkspaceTool('git')).toEqual({ panel: 'left', view: 'git' })
    expect(routeWorkspaceTool('files')).toEqual({ panel: 'left', view: 'files' })
  })
  it('其它工具进右栏同名视图', () => {
    for (const id of ['artifacts', 'browser', 'tasks', 'sandbox', 'copies'])
      expect(routeWorkspaceTool(id)).toEqual({ panel: 'right', view: id })
  })
  it('文件标签和不认识的 id 返回 null', () => {
    expect(routeWorkspaceTool('file:abc')).toBeNull()
    expect(routeWorkspaceTool('nope')).toBeNull()
    expect(routeWorkspaceTool('toString')).toBeNull()
    expect(routeWorkspaceTool('')).toBeNull()
  })
})
