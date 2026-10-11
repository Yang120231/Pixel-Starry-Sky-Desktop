// 自定义 API 的上下文长度 → Claude Code 的自动压缩窗口（docs/ui/custom-api.md §9）
import { describe, expect, it } from 'vitest'
import { MODEL_SETTINGS_ENV, compactWindows, gatewaySettings, longContextModels } from './compact-window'

describe('自定义 API 的自动压缩窗口', () => {
  it('只给填了上下文长度的模型；夹到 Claude Code 接受的 100K–1M', () => {
    expect(
      compactWindows([
        { id: 'anthropic/claude-v4.1flash', contextWindow: 128_000 },
        { id: 'small', contextWindow: 32_000 },
        { id: 'huge', contextWindow: 2_000_000 },
        { id: 'plain' },
        { id: 'cleared', contextWindow: null },
      ]),
    ).toEqual({
      'anthropic/claude-v4.1flash': { autoCompactWindow: 128_000 },
      small: { autoCompactWindow: 100_000 },
      huge: { autoCompactWindow: 1_000_000 },
    })
  })

  it('都没填：不写 modelSettings', () => {
    expect(compactWindows([{ id: 'a' }, { id: 'b', contextWindow: null }])).toBeNull()
    expect(compactWindows([])).toBeNull()
  })

  it('远程机器：带过来的按模型设置放进 modelSettings，不留在 env 里', () => {
    const windows = { m: { autoCompactWindow: 150_000 } }
    expect(
      gatewaySettings({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', [MODEL_SETTINGS_ENV]: JSON.stringify(windows) }),
    ).toEqual({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' }, modelSettings: windows })
    expect(gatewaySettings({ ANTHROPIC_MODEL: 'm' })).toEqual({ env: { ANTHROPIC_MODEL: 'm' } })
    expect(gatewaySettings({ ANTHROPIC_MODEL: 'm', [MODEL_SETTINGS_ENV]: 'oops' })).toEqual({
      env: { ANTHROPIC_MODEL: 'm' },
    })
  })

  it('超过 200K 的模型要带 [1m] 启动；200K 及以下、没填的不用（§10）', () => {
    expect(
      longContextModels([
        { id: 'big', contextWindow: 272_000 },
        { id: 'exact', contextWindow: 200_000 },
        { id: 'small', contextWindow: 128_000 },
        { id: 'plain' },
      ]),
    ).toEqual(['big'])
  })
})
