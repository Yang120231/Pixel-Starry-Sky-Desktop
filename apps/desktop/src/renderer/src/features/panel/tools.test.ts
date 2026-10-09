import { describe, expect, it } from 'vitest'
import { allMessages } from '../../../../shared/i18n/translate'
import { GROUP_KEY, hintKey, TOOL_GROUPS, TOOLS } from './tools'
import { TOOL_IDS } from './workspaceState'

describe('right workspace tool registry', () => {
  it('covers every tool exactly once, grouped in group order', () => {
    expect([...TOOLS.map(tool => tool.id)].sort()).toEqual([...TOOL_IDS].sort())
    // 同一分组的工具连在一起，分组顺序和 TOOL_GROUPS 一致（菜单按相邻分组插标题）
    const groups = TOOLS.map(tool => tool.group).filter((g, i, all) => all[i - 1] !== g)
    expect(groups).toEqual([...TOOL_GROUPS])
  })
  it('has a name, a hint and group titles in the dictionary', () => {
    for (const tool of TOOLS) {
      expect(allMessages).toHaveProperty([`workspace.${tool.id}`])
      expect(allMessages).toHaveProperty([hintKey(tool.id)])
    }
    for (const group of TOOL_GROUPS) expect(allMessages).toHaveProperty([GROUP_KEY[group]])
  })
})
