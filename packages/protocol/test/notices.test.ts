import { describe, expect, it } from 'vitest'
import { isQuietWarning } from '../src/notices'

describe('isQuietWarning', () => {
  it('认出 Codex 的配置类警告（单复数、前面有空白）', () => {
    expect(
      isQuietWarning(
        'Codex is ignoring 2 unrecognized configuration settings. Check for typos or deprecated settings.\n  user (~/.codex/config.toml): `x` is ignored.',
      ),
    ).toBe(true)
    expect(isQuietWarning('Codex is ignoring 1 unrecognized configuration setting.')).toBe(true)
    expect(
      isQuietWarning(
        '\nUnder-development features enabled: local_thread_store_compaction. Under-development features are incomplete.',
      ),
    ).toBe(true)
  })
  it('别的警告和报错不算', () => {
    expect(isQuietWarning('Model metadata for `gpt-x` not found.')).toBe(false)
    expect(isQuietWarning('Reconnecting... 1/5')).toBe(false)
    expect(isQuietWarning('提示：Codex is ignoring 2 unrecognized configuration settings')).toBe(false)
    expect(isQuietWarning('')).toBe(false)
  })
})
