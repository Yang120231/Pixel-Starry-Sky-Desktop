import { describe, expect, it } from 'vitest'
import type { SessionLane } from '@/features/board/sessionLanes'
import {
  PROJECT_COLORS,
  projectColor,
  projectCounts,
  projectFolders,
  projectInitial,
  visibleSessions,
} from './projectTreeModel'

const session = (id: string, status: 'idle' | 'running' | 'unread' = 'idle') => ({ id, title: id, status })

describe('侧栏项目方块', () => {
  it('颜色按 ID 固定，在调色板里', () => {
    expect(projectColor('local:abc')).toBe(projectColor('local:abc'))
    expect(PROJECT_COLORS).toContain(projectColor('local:abc'))
    const colors = new Set(Array.from({ length: 40 }, (_, i) => projectColor(`p${i}`)))
    expect(colors.size).toBeGreaterThan(4)
  })

  it('取第一个字母、数字或汉字，字母大写', () => {
    expect(projectInitial('pixel-web')).toBe('P')
    expect(projectInitial('.dotfiles')).toBe('D')
    expect(projectInitial('  像素星空')).toBe('像')
    expect(projectInitial('_')).toBe('_')
    expect(projectInitial('')).toBe('?')
  })
})

describe('项目标题的状态数', () => {
  it('等你批准 / 出错 / 暂停算等你，在跑算运行，新回复都不算', () => {
    const lanes = new Map<string, SessionLane>([
      ['a', 'running'],
      ['b', 'waiting'],
      ['c', 'failed'],
      ['d', 'unread'],
    ])
    // e 没进看板分类但状态是 running（刚开始跑）也算
    const sessions = [
      session('a', 'running'),
      session('b', 'running'),
      session('c'),
      session('d', 'unread'),
      session('e', 'running'),
    ]
    expect(projectCounts(sessions, lanes)).toEqual({ running: 2, waiting: 2 })
  })
})

describe('先列哪几个对话', () => {
  const sessions = Array.from({ length: 9 }, (_, i) => session(`s${i}`))
  const none = new Map<string, SessionLane>()

  it('不超过 5 个全部列出', () => {
    expect(visibleSessions(sessions.slice(0, 5), { all: false, selected: null, lanes: none })).toEqual({
      shown: sessions.slice(0, 5),
      hidden: 0,
    })
  })

  it('先列 5 个，后面的只露当前打开的和有状态的', () => {
    const list = sessions.map(s => (s.id === 's7' ? session('s7', 'unread') : s))
    const lanes = new Map<string, SessionLane>([['s6', 'waiting']])
    const { shown, hidden } = visibleSessions(list, { all: false, selected: 's8', lanes })
    expect(shown.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's6', 's7', 's8'])
    expect(hidden).toBe(1)
  })

  it('点了「还有 N 个」全部列出', () => {
    expect(visibleSessions(sessions, { all: true, selected: null, lanes: none })).toEqual({
      shown: sessions,
      hidden: 0,
    })
  })
})

describe('多文件夹项目的文件夹', () => {
  it('主文件夹在前、编号 0，附加文件夹从 1 起，有名字用名字', () => {
    expect(
      projectFolders({
        path: 'D:/PixelSky',
        folders: [{ path: 'D:/PixelSky-cloud', name: 'cloud' }, { path: 'E:\\docs' }],
      }),
    ).toEqual([
      { index: 0, name: 'PixelSky', path: 'D:/PixelSky' },
      { index: 1, name: 'cloud', path: 'D:/PixelSky-cloud' },
      { index: 2, name: 'docs', path: 'E:\\docs' },
    ])
  })

  it('单文件夹项目没有', () => {
    expect(projectFolders({ path: 'D:/PixelSky' })).toEqual([])
    expect(projectFolders({ path: 'D:/PixelSky', folders: [] })).toEqual([])
  })
})
