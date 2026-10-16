import { describe, expect, it, vi } from 'vitest'
import type { NativeImportResult } from '@pixelsky/protocol'
import { chooseRow, isGoneError, settingsWhenReady, type ChooseDeps } from './choose'
import { mergeRows, type ResumeRow } from './model'

const row = (extra: Partial<ResumeRow> = {}): ResumeRow =>
  mergeRows(
    [
      {
        id: '3f1c2a10-6d7e-4b88-9a31-0c5d8e7a1001',
        title: 't',
        firstPrompt: '',
        lastPrompt: null,
        branch: null,
        subdir: null,
        updatedAt: 1,
        size: 1,
        model: null,
        source: 'terminal',
        ownerId: null,
        live: null,
        ...extra,
      },
    ],
    new Map(),
  )[0]

const deps = (result: NativeImportResult = { sessionId: 'new', model: null, turns: 3, shown: 3 }) => {
  const importSession = vi.fn<ChooseDeps['importSession']>(async () => result)
  const modelOf = vi.fn<ChooseDeps['modelOf']>(async () => 'claude-opus-4-1')
  const settingsFor = vi.fn((model: string | null) => ({ model }))
  return { importSession, modelOf, settingsFor, token: 't1' } satisfies ChooseDeps
}

describe('chooseRow', () => {
  it('已被占用的直接跳过去，不导入', async () => {
    const d = deps()
    expect(await chooseRow(row({ ownerId: 'conv-1' }), 'default', d)).toEqual({ kind: 'owned', sessionId: 'conv-1' })
    expect(d.importSession).not.toHaveBeenCalled()
  })
  it('没开着的原地导入，设置带上会话最后用的模型；尾部还没补到时单独要一次', async () => {
    const d = deps()
    expect(await chooseRow(row(), 'default', d)).toEqual({ kind: 'opened', sessionId: 'new' })
    expect(d.modelOf).toHaveBeenCalledTimes(1)
    expect(d.importSession).toHaveBeenCalledWith(expect.any(String), {
      mode: 'inplace',
      settings: { model: 'claude-opus-4-1' },
      token: 't1',
    })
    const known = deps()
    await chooseRow(row({ model: 'claude-haiku-4-5' }), 'default', known)
    expect(known.modelOf).not.toHaveBeenCalled()
    expect(known.settingsFor).toHaveBeenCalledWith('claude-haiku-4-5')
  })
  it('设置可以晚一点给（等输入框准备好），导入用等到的那份', async () => {
    const d = { ...deps(), settingsFor: vi.fn(async (model: string | null) => ({ model, effort: 'high' as const })) }
    await chooseRow(row({ model: 'claude-haiku-4-5' }), 'default', d)
    expect(d.importSession.mock.calls[0][1].settings).toEqual({ model: 'claude-haiku-4-5', effort: 'high' })
  })
  it('终端里正开着：Enter 默认走复制一份接着聊；显式原地也照办', async () => {
    const d = deps()
    await chooseRow(row({ live: 'terminal' }), 'default', d)
    expect(d.importSession.mock.calls[0][1].mode).toBe('copy')
    const e = deps()
    await chooseRow(row({ live: 'terminal' }), 'inplace', e)
    expect(e.importSession.mock.calls[0][1].mode).toBe('inplace')
  })
  it('可能还开着：默认原地，点复制按钮走 copy', async () => {
    const d = deps()
    await chooseRow(row({ live: 'maybe' }), 'default', d)
    await chooseRow(row({ live: 'maybe' }), 'copy', d)
    expect(d.importSession.mock.calls.map(c => c[1].mode)).toEqual(['inplace', 'copy'])
  })
  it('导入时发现已被占用 / 正开着，原样交给界面', async () => {
    expect(await chooseRow(row(), 'default', deps({ ownerId: 'c9' }))).toEqual({ kind: 'owned', sessionId: 'c9' })
    expect(await chooseRow(row(), 'default', deps({ live: 'other' }))).toEqual({ kind: 'live', live: 'other' })
  })
  it('导入失败（记录没了）把错误抛出去，由界面刷新列表', async () => {
    const d = deps()
    d.importSession.mockRejectedValueOnce(new Error('这个会话的记录已经不在了'))
    await expect(chooseRow(row(), 'default', d)).rejects.toThrow('不在了')
    expect(isGoneError('这个会话的记录已经不在了')).toBe(true)
    expect(isGoneError('工作目录不存在')).toBe(false)
  })
})

describe('settingsWhenReady', () => {
  const wait = vi.fn(async () => undefined)
  it('没有输入框（命令面板）：引擎默认', async () => {
    expect(await settingsWhenReady(undefined, 'm')).toEqual({})
  })
  it('输入框刚启动还没准备好：等到有了再用，拿的是会话的模型', async () => {
    let ready = false
    const settingsFor = vi.fn((model: string | null) => (ready ? { model } : undefined))
    wait
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        ready = true
      })
    expect(await settingsWhenReady(settingsFor, 'claude-haiku-5-5', wait)).toEqual({ model: 'claude-haiku-5-5' })
    expect(settingsFor).toHaveBeenCalledTimes(3)
  })
  it('平台线路还在加载：先等，加载好了就用', async () => {
    let calls = 0
    const settingsFor = vi.fn((model: string | null) => {
      if (++calls < 3) throw new Error('loading')
      return { model }
    })
    expect(await settingsWhenReady(settingsFor, 'm', wait)).toEqual({ model: 'm' })
  })
  it('一直没准备好：引擎默认；一直报错：把错误交出去', async () => {
    expect(await settingsWhenReady(() => undefined, 'm', wait)).toEqual({})
    await expect(
      settingsWhenReady(
        () => {
          throw new Error('sign in')
        },
        'm',
        wait,
      ),
    ).rejects.toThrow('sign in')
  })
})
