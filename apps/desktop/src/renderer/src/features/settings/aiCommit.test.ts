// AI 写提交信息的设置（docs/ui/ai-commit-codex-warnings-history.md §2.3）：读设置、选线路、选接口、估算费用
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformGroup } from '@/features/account/platform'
import type { ProviderView } from '../../../../shared/types/providers'
import {
  AI_COMMIT_MODEL_KEY,
  AI_COMMIT_WRITING_KEY,
  commitGroups,
  commitProvider,
  DEFAULT_MODEL,
  DEFAULT_WRITING,
  estimateUsd,
  readModel,
  readWriting,
} from './aiCommit'

const group = (id: string, rate: number, models: string[]): PlatformGroup =>
  ({ id, name: 'g' + id, rate_multiplier: rate, models, modelsError: null }) as PlatformGroup
const provider = (id: string, models: string[], keyHint: string | null = '1234'): ProviderView =>
  ({ id, name: id, models: models.map(m => ({ id: m })), keyHint }) as ProviderView

describe('读设置', () => {
  const data = new Map<string, string>()
  beforeEach(() => {
    data.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('没有存过时用默认：显示按钮、跟随仓库、标题加正文、云端 Opus 5.5、自动线路', () => {
    expect(readWriting()).toEqual(DEFAULT_WRITING)
    expect(readModel()).toEqual(DEFAULT_MODEL)
    expect(DEFAULT_MODEL.model).toBe('claude-opus-5-5')
  })
  it('不合法的值回到默认；额外要求最多 1000 字', () => {
    localStorage.setItem(
      AI_COMMIT_WRITING_KEY,
      JSON.stringify({ enabled: 'yes', language: 'fr', style: 'subject', instructions: 'x'.repeat(1200) }),
    )
    localStorage.setItem(AI_COMMIT_MODEL_KEY, JSON.stringify({ source: 'custom', groupId: '../x', model: 7 }))
    expect(readWriting()).toEqual({ enabled: true, language: 'auto', style: 'subject', instructions: 'x'.repeat(1000) })
    expect(readModel()).toMatchObject({ source: 'custom', groupId: null, model: 'claude-opus-5-5' })
    localStorage.setItem(AI_COMMIT_MODEL_KEY, '{not json')
    expect(readModel()).toEqual(DEFAULT_MODEL)
  })
})

describe('commitGroups', () => {
  const groups = [
    group('1', 1, ['claude-opus-5-5', 'claude-sonnet-5-5']),
    group('2', 0.5, ['claude-opus-5-5']),
    group('3', 0.8, ['claude-sonnet-5-5']),
    group('4', 2, ['claude-opus-5-5']),
    group('5', 0.9, ['claude-opus-5-5']),
  ]
  it('自动：默认线路有这个模型就先用它，再按倍率从低到高，最多 3 条', () => {
    expect(commitGroups(groups, 'claude-opus-5-5', null, '4')).toEqual(['4', '2', '5'])
    expect(commitGroups(groups, 'claude-opus-5-5', null, '3')).toEqual(['2', '5', '1'])
    expect(commitGroups(groups, 'claude-opus-5-5', null, null)).toEqual(['2', '5', '1'])
  })
  it('指定了线路就只用它；线路没有这个模型时为空', () => {
    expect(commitGroups(groups, 'claude-opus-5-5', '1', '2')).toEqual(['1'])
    expect(commitGroups(groups, 'claude-opus-5-5', '3', null)).toEqual([])
    expect(commitGroups(groups, 'claude-haiku-5-5', null, '1')).toEqual([])
  })
})

describe('commitProvider', () => {
  const list = [provider('empty', []), provider('a', ['m1', 'm2']), provider('b', ['n1'])]
  it('用设置里选的接口和模型；接口删了或没有模型时用第一个有模型的接口', () => {
    expect(commitProvider(list, { providerId: 'b', providerModel: 'n1' })).toMatchObject({
      provider: { id: 'b' },
      model: 'n1',
    })
    expect(commitProvider(list, { providerId: 'a', providerModel: 'gone' })?.model).toBe('m1')
    expect(commitProvider(list, { providerId: 'deleted', providerModel: null })?.provider.id).toBe('a')
    expect(commitProvider(list, { providerId: 'empty', providerModel: null })?.provider.id).toBe('a')
    expect(commitProvider([provider('x', [])], { providerId: null, providerModel: null })).toBeNull()
  })
})

describe('estimateUsd', () => {
  it('官方价乘线路倍率；没有用量或查不到价格时为 null', () => {
    const usage = { input: 20_000, output: 300, cacheRead: 0, cacheWrite: 0 }
    // Opus 5.5：输入 $4、输出 $20 / 百万 token
    expect(estimateUsd(usage, 'claude-opus-5-5')).toBeCloseTo(0.086, 6)
    expect(estimateUsd(usage, 'claude-opus-5-5', 0.5)).toBeCloseTo(0.043, 6)
    expect(estimateUsd(null, 'claude-opus-5-5')).toBeNull()
    expect(estimateUsd(usage, 'my-private-model')).toBeNull()
    expect(estimateUsd(usage, 'my-private-model', 1, 'claude-opus-5-5')).toBeCloseTo(0.086, 6)
  })
})
