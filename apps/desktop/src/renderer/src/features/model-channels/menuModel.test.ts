import { describe, expect, it } from 'vitest'
import type { EngineId } from '@pixelsky/protocol'
import type { ChannelGroupView, ChannelId, ChannelRow, ChannelState } from './channelModel'
import {
  highlightParts,
  isUnset,
  listRows,
  parseMenuLayout,
  resolveView,
  searchChannels,
  splitChannels,
  stepView,
} from './menuModel'

function row(channel: ChannelId, model: string, opts: { candidates?: EngineId[] } = {}): ChannelRow {
  const candidates = opts.candidates ?? ['claude']
  return {
    key: `${channel}:${model}`,
    target: { channel, model, providerId: null },
    candidates,
    pick: {
      engine: candidates[0],
      options: candidates,
      fallbackFrom: null,
      unavailable: false,
    },
    selected: false,
    disabled: null,
  }
}

const ready: ChannelState = { kind: 'ready' }
const g = (channel: ChannelId, rows: ChannelRow[], state: ChannelState = ready): ChannelGroupView => ({
  channel,
  state,
  rows,
})
const models = (channel: ChannelId, n: number): ChannelRow[] =>
  Array.from({ length: n }, (_, i) => row(channel, `${channel}-m${i}`))

describe('parseMenuLayout', () => {
  it('只认 "cols"，其余（含坏数据）都是标签页', () => {
    expect(parseMenuLayout(JSON.stringify('cols'))).toBe('cols')
    expect(parseMenuLayout(JSON.stringify('tabs'))).toBe('tabs')
    expect(parseMenuLayout(null)).toBe('tabs')
    expect(parseMenuLayout('cols')).toBe('tabs')
    expect(parseMenuLayout('{')).toBe('tabs')
  })
})

describe('splitChannels', () => {
  const groups = [
    g('platform', [], { kind: 'signin' }),
    g('claude', models('claude', 3)),
    g('chatgpt', [], { kind: 'auth' }),
    g('custom', [], { kind: 'empty' }),
  ]

  it('没登录、没授权、没装、没接口的收进「＋」；读取中、出错的照常显示', () => {
    expect(isUnset({ kind: 'missing' })).toBe(true)
    expect(isUnset({ kind: 'loading' })).toBe(false)
    expect(isUnset({ kind: 'error', message: null })).toBe(false)
    const { shown, unset } = splitChannels(groups, { current: 'claude', started: false })
    expect(shown.map(x => x.channel)).toEqual(['claude'])
    expect(unset.map(x => x.channel)).toEqual(['platform', 'chatgpt', 'custom'])
  })

  it('已开始的对话正在用的通道失效了也显示；新任务不留', () => {
    expect(splitChannels(groups, { current: 'chatgpt', started: true }).shown.map(x => x.channel)).toEqual([
      'claude',
      'chatgpt',
    ])
    expect(splitChannels(groups, { current: 'chatgpt', started: false }).shown.map(x => x.channel)).toEqual(['claude'])
  })
})

describe('resolveView / stepView', () => {
  const channels = splitChannels(
    [g('platform', models('platform', 2)), g('claude', models('claude', 2)), g('chatgpt', [], { kind: 'auth' })],
    { current: 'claude', started: false },
  )

  it('打开时停在上次看的，不在了就看当前通道，再不在就第一个', () => {
    expect(resolveView(null, channels, 'claude')).toBe('claude')
    expect(resolveView('platform', channels, 'claude')).toBe('platform')
    expect(resolveView('chatgpt', channels, 'claude')).toBe('claude')
    expect(resolveView(null, channels, 'custom')).toBe('platform')
    expect(resolveView('add', channels, 'claude')).toBe('add')
  })

  it('没有可添加的通道时不停在「＋」；什么都没设置时只有「＋」', () => {
    const all = splitChannels([g('platform', models('platform', 1))], { current: 'platform', started: false })
    expect(resolveView('add', all, 'platform')).toBe('platform')
    const none = splitChannels([g('platform', [], { kind: 'signin' })], { current: 'claude', started: false })
    expect(resolveView(null, none, 'claude')).toBe('add')
    expect(stepView('add', none, 1)).toBe('add')
  })

  it('←/→ 在显示的通道和「＋」之间转圈', () => {
    expect(stepView('platform', channels, 1)).toBe('claude')
    expect(stepView('claude', channels, 1)).toBe('add')
    expect(stepView('add', channels, 1)).toBe('platform')
    expect(stepView('platform', channels, -1)).toBe('add')
  })
})

describe('listRows', () => {
  const split = (groups: ChannelGroupView[]) => splitChannels(groups, { current: 'claude', started: false })

  it('取最长的通道，夹在 4～8 行', () => {
    expect(listRows(split([g('claude', models('claude', 2))]))).toBe(4)
    expect(listRows(split([g('claude', models('claude', 6)), g('custom', models('custom', 2))]))).toBe(6)
    expect(listRows(split([g('platform', models('platform', 20))]))).toBe(8)
  })

  it('平台多一行「管理模型」，额外的行（线路、展开的接口）算进去', () => {
    expect(listRows(split([g('platform', models('platform', 4))]))).toBe(5)
    expect(listRows(split([g('platform', models('platform', 4))]), x => (x.channel === 'platform' ? 1 : 0))).toBe(6)
  })

  it('「＋」页按通道数估', () => {
    const unset = split([
      g('claude', models('claude', 1)),
      g('platform', [], { kind: 'signin' }),
      g('chatgpt', [], { kind: 'auth' }),
      g('custom', [], { kind: 'empty' }),
    ])
    expect(listRows(unset)).toBe(6)
  })
})

describe('searchChannels', () => {
  const channels = splitChannels(
    [
      g('platform', [
        row('platform', 'claude-opus-5-5'),
        row('platform', 'gpt-6-sol', { candidates: ['codex', 'pixel'] }),
        row('platform', 'gpt-6-luna', { candidates: ['codex', 'pixel'] }),
      ]),
      g('claude', [row('claude', 'opus'), row('claude', 'haiku')]),
      g('chatgpt', [], { kind: 'auth' }),
    ],
    { current: 'claude', started: true },
  )
  const text = (_: ChannelGroupView, r: ChannelRow) =>
    `${r.target.model} ${r.target.model === 'opus' ? 'Opus 5.5' : ''}`

  it('跨通道按文字找，不分大小写；没命中的通道不出现', () => {
    const found = searchChannels(channels, 'OPUS', text)
    expect(found.map(x => [x.group.channel, x.rows.map(r => r.target.model)])).toEqual([
      ['platform', ['claude-opus-5-5']],
      ['claude', ['opus']],
    ])
  })

  it('别的引擎才能跑的模型也能搜到（选了会换引擎）', () => {
    const found = searchChannels(channels, 'gpt-6', text)
    expect(found.map(x => [x.group.channel, x.rows.map(r => r.target.model)])).toEqual([
      ['platform', ['gpt-6-sol', 'gpt-6-luna']],
    ])
  })

  it('失效的通道不搜', () => {
    const broken = splitChannels([g('chatgpt', [], { kind: 'auth' })], { current: 'chatgpt', started: true })
    expect(broken.shown).toHaveLength(1)
    expect(searchChannels(broken, 'gpt', text)).toEqual([])
  })
})

describe('highlightParts', () => {
  it('切出命中的一段，保留原来的大小写', () => {
    expect(highlightParts('claude-Opus-5-5', 'opus')).toEqual(['claude-', 'Opus', '-5-5'])
    expect(highlightParts('haiku', ' ')).toBeNull()
    expect(highlightParts('haiku', 'sonnet')).toBeNull()
  })
})
