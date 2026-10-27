import { describe, expect, it } from 'vitest'
import { claudeTuiArgs, TO_CLAUDE_MODE } from './session'
import type { SessionSettings } from '@pixelsky/protocol'

const base: SessionSettings = {
  permissionMode: 'ask',
  model: 'claude-sonnet-4-5',
  effort: 'high',
  ultracode: false,
  fast: false,
  thinkingSummaries: false,
}

/** 与 ClaudeAdapter.tuiLaunch 里拼 --plugin-dir / --mcp-config 同一套规则 */
function appendTuiExtensions(
  args: string[],
  extensions?: { pluginDirs?: string[]; mcpFile?: string | null },
): string[] {
  const out = [...args]
  for (const path of extensions?.pluginDirs ?? []) out.push('--plugin-dir', path)
  if (extensions?.mcpFile) out.push('--mcp-config', extensions.mcpFile)
  return out
}

describe('claudeTuiArgs', () => {
  it('resumes with --resume when continuing', () => {
    const args = claudeTuiArgs(base, 'sid-1', true)
    expect(args).toContain('--resume')
    expect(args).toContain('sid-1')
    expect(args).not.toContain('-p')
    expect(args).not.toContain('--input-format')
    expect(args).not.toContain('--disallowedTools')
  })

  it('opens new session with --session-id', () => {
    const args = claudeTuiArgs({ ...base, permissionMode: 'full' }, 'new-sid', false)
    expect(args).toEqual(
      expect.arrayContaining([
        '--permission-mode',
        TO_CLAUDE_MODE.full,
        '--session-id',
        'new-sid',
        '--model',
        base.model!,
        '--effort',
        'high',
      ]),
    )
    expect(args).not.toContain('--resume')
  })

  it('appends user launch args last', () => {
    const args = claudeTuiArgs(base, 'sid', true, { args: ['--verbose'] })
    expect(args.at(-1)).toBe('--verbose')
  })

  it('tuiLaunch appends --plugin-dir and --mcp-config like headless claudeArgs', () => {
    const args = appendTuiExtensions(claudeTuiArgs(base, 'sid', true), {
      pluginDirs: ['/plugins/a', '/plugins/b'],
      mcpFile: '/tmp/mcp.json',
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '--plugin-dir',
        '/plugins/a',
        '--plugin-dir',
        '/plugins/b',
        '--mcp-config',
        '/tmp/mcp.json',
      ]),
    )
  })
})

describe('NATIVE_TEXT.tuiSynced', () => {
  it('matches systemMessages template placeholders', async () => {
    const { NATIVE_TEXT } = await import('../native/text')
    expect(NATIVE_TEXT.tuiSynced(3)).toBe('在终端里聊了 3 轮 · 已补上')
    expect(NATIVE_TEXT.tuiSynced(1)).toMatch(/在终端里聊了 1 轮/)
  })
})
