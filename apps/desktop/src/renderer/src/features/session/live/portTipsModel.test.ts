import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import { discoverPorts, portsOfOutput, type PortCache } from './portTipsModel'

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
