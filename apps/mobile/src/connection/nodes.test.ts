import { describe, expect, it, vi } from 'vitest'
import { matchNode, parseNodes, pickNode, wsUrl } from './nodes'

const ORIGIN = 'https://cloud.example.test'
const NODES = {
  nodes: [
    { name: '优质 1', url: 'wss://p1.example.test/v1/bridge/ws', premium: true },
    { name: '只写主机', url: 'wss://p2.example.test', premium: 'yes' },
    { name: '坏的', url: 'https://p3.example.test' },
    { name: '带密码', url: 'wss://u:p@p4.example.test' },
    'junk',
  ],
}

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('parseNodes', () => {
  it('只留 ws / wss 地址，只写主机的补上中转路径', () => {
    expect(parseNodes(NODES)).toEqual([
      { name: '优质 1', url: 'wss://p1.example.test/v1/bridge/ws', premium: true },
      { name: '只写主机', url: 'wss://p2.example.test/v1/bridge/ws', premium: false },
    ])
    expect(parseNodes(null)).toEqual([])
    expect(parseNodes({ nodes: 'x' })).toEqual([])
  })

  it('wsUrl 去掉查询参数', () => {
    expect(wsUrl('wss://a.test/v1/bridge/ws?role=desktop')).toBe('wss://a.test/v1/bridge/ws')
    expect(wsUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('matchNode', () => {
  const nodes = parseNodes(NODES)
  it('按来源比，返回列表里的地址', () => {
    expect(matchNode('wss://p1.example.test/v1/bridge/ws', nodes)).toBe('wss://p1.example.test/v1/bridge/ws')
    expect(matchNode('wss://p2.example.test/other', nodes)).toBe('wss://p2.example.test/v1/bridge/ws')
  })
  it('不在列表里、端口或协议不同、格式不对：null', () => {
    expect(matchNode('wss://evil.test/v1/bridge/ws', nodes)).toBeNull()
    expect(matchNode('wss://p1.example.test:8443/v1/bridge/ws', nodes)).toBeNull()
    expect(matchNode('ws://p1.example.test/v1/bridge/ws', nodes)).toBeNull()
    expect(matchNode(undefined, nodes)).toBeNull()
  })
})

describe('pickNode', () => {
  it('二维码里的节点在主站列表里：用它', async () => {
    const f = respond(200, NODES)
    expect(await pickNode('wss://p1.example.test/v1/bridge/ws', ORIGIN, f)).toBe('wss://p1.example.test/v1/bridge/ws')
    expect(f).toHaveBeenCalledWith(ORIGIN + '/v1/bridge/nodes', expect.anything())
  })

  it('不在列表里：照旧用页面来源', async () => {
    expect(await pickNode('wss://evil.test/v1/bridge/ws', ORIGIN, respond(200, NODES))).toBeNull()
  })

  it('接口 404（云端旧版本）或出错：照旧用页面来源', async () => {
    expect(await pickNode('wss://p1.example.test/v1/bridge/ws', ORIGIN, respond(404, {}))).toBeNull()
    const broken = vi.fn(async () => {
      throw new TypeError('offline')
    }) as unknown as typeof fetch
    expect(await pickNode('wss://p1.example.test/v1/bridge/ws', ORIGIN, broken)).toBeNull()
  })

  it('和页面同源、没有中转地址：不问接口', async () => {
    const f = respond(200, NODES)
    expect(await pickNode('wss://cloud.example.test/v1/bridge/ws', ORIGIN, f)).toBeNull()
    expect(await pickNode(undefined, ORIGIN, f)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
