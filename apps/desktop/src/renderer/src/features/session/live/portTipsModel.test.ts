import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import {
  IGNORED_SESSIONS,
  discoverPorts,
  portsOfOutput,
  readIgnored,
  saveIgnored,
  type PortCache,
} from './portTipsModel'

const ESC = '\u001b'
const cmd = (id: string, output: string, command = 'pnpm dev'): Item =>
  ({ kind: 'command', id, command, output, exitCode: null, status: 'running' }) as Item

describe('portsOfOutput', () => {
  it('颜色码夹在 localhost: 和端口之间也能认出来', () => {
    expect(portsOfOutput(`  Local:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m`)).toEqual([5173])
  })
  it('没有本机地址就没有端口', () => {
    expect(portsOfOutput('listening on http://example.com:8080')).toEqual([])
  })
})

describe('discoverPorts', () => {
  it('按首次出现的顺序，同一端口只算一次，只看命令条目', () => {
    const items = [
      cmd('a', 'web http://localhost:5173/'),
      { kind: 'tool', id: 't', output: 'http://localhost:9999' } as unknown as Item,
      cmd('b', 'api http://localhost:8080 and again http://localhost:5173', 'pnpm --filter api dev'),
      cmd('c', ''),
    ]
    expect(discoverPorts(items).map(f => [f.port, f.command])).toEqual([
      [5173, 'pnpm dev'],
      [8080, 'pnpm --filter api dev'],
    ])
  })
  it('输出没变就用缓存，变了重新扫', () => {
    const cache: PortCache = new Map()
    discoverPorts([cmd('a', 'http://localhost:3000')], cache)
    cache.set('a', { output: 'http://localhost:3000', ports: [1] })
    expect(discoverPorts([cmd('a', 'http://localhost:3000')], cache)[0].port).toBe(1)
    expect(discoverPorts([cmd('a', 'http://localhost:3001')], cache)[0].port).toBe(3001)
  })
})

describe('忽略记录跨重启', () => {
  const data = new Map<string, string>()
  beforeEach(() => {
    data.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('按会话存取；坏数据当没有；超过上限丢最早忽略的会话', () => {
    expect(readIgnored('a')).toEqual([])
    saveIgnored('a', [5173])
    saveIgnored('b', [3000, 9333])
    expect(readIgnored('a')).toEqual([5173])
    expect(readIgnored('b')).toEqual([3000, 9333])
    data.set('pixelsky.portTip.ignored', 'not json')
    expect(readIgnored('a')).toEqual([])
    for (let i = 0; i <= IGNORED_SESSIONS; i++) saveIgnored(`s${i}`, [i + 1])
    expect(readIgnored('s0')).toEqual([])
    expect(readIgnored(`s${IGNORED_SESSIONS}`)).toEqual([IGNORED_SESSIONS + 1])
  })
})
