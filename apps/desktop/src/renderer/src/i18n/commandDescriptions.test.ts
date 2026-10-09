import { describe, expect, it } from 'vitest'
import type { SkillCommand } from '@pixelsky/protocol'
import { commandDescription } from './commandDescriptions'

const compact: SkillCommand = { name: 'compact', description: 'Free up context by summarizing the conversation so far', source: 'engine', builtin: true }

describe('Claude Code 命令说明的语言与来源边界', () => {
  it('中文说明覆盖引擎内置提示，英文仍使用 CLI 原始说明', () => {
    expect(commandDescription(compact, 'zh-CN')).toContain('释放上下文')
    expect(commandDescription(compact, 'en-US')).toBe(compact.description)
    expect(commandDescription({ ...compact, name: 'btw' }, 'zh-CN')).toContain('不加入主对话上下文')
  })
  it('同名用户技能、插件和没有原生标记的旧清单保持原文', () => {
    const original = 'My compact skill: keep {source} unchanged'
    for (const command of [
      { ...compact, description: original, builtin: false },
      { ...compact, description: original, builtin: undefined },
      { ...compact, description: original, source: 'configured' as const },
      { ...compact, description: original, name: 'my-plugin:compact' },
      { ...compact, description: original, name: 'unknown-command' },
    ]) {
      expect(commandDescription(command, 'zh-CN')).toBe(original)
      expect(commandDescription(command, 'en-US')).toBe(original)
    }
  })
  it('只有已知内置命令的空英文说明使用后备，不制造新候选', () => {
    expect(commandDescription({ ...compact, description: '' }, 'en-US')).toContain('Summarize')
    expect(commandDescription({ ...compact, name: 'my-skill', description: '' }, 'zh-CN')).toBe('')
  })
})
