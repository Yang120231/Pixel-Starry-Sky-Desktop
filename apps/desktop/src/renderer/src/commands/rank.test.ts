import { describe, expect, it } from 'vitest'
import { rankCommands } from './rank'
const commands = [
  { id: 'new', label: '新建终端', keywords: 'new terminal shell', category: '终端' },
  { id: 'close', label: '关闭终端', keywords: 'close terminal', category: '终端' },
  { id: 'theme', label: '深色主题', keywords: 'dark theme', category: '外观' },
]
describe('command search', () => {
  it('matches all query words in either language with stable ordering', () => {
    expect(rankCommands(commands, 'TERMINAL new', []).map(c=>c.id)).toEqual(['new'])
    expect(rankCommands(commands, '终端', ['close']).map(c=>c.id)).toEqual(['close','new'])
    expect(rankCommands(commands, '主题 terminal', [])).toEqual([])
  })
  it('prefers exact names over recent history and ignores unknown history ids', () => {
    expect(rankCommands(commands, '新建终端', ['close']).map(c=>c.id)).toEqual(['new'])
    expect(rankCommands(commands, '', ['missing','theme']).map(c=>c.id)).toEqual(['theme','new','close'])
  })
})
