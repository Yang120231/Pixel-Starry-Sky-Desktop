import { describe, expect, it } from 'vitest'
import { findPorts, mergePorts } from './portsModel'

describe('findPorts', () => {
  it('认 localhost / 127.0.0.1 / 0.0.0.0 / [::1]，去重并排序', () => {
    const text = [
      '  Local:   http://localhost:5173/',
      'api on https://127.0.0.1:3000/x',
      'bind http://0.0.0.0:8080',
      'v6 http://[::1]:4000',
      'again http://localhost:5173/',
    ].join('\n')
    expect(findPorts(text)).toEqual([3000, 4000, 5173, 8080])
  })
  it('忽略外网地址、没有端口的地址和越界端口', () => {
    expect(findPorts('http://example.com:3000 http://localhost/ http://localhost:99999')).toEqual([])
  })
  it('空文字', () => {
    expect(findPorts('')).toEqual([])
  })
})

describe('mergePorts', () => {
  it('同端口合并来源，按端口排序', () => {
    const list = mergePorts(
      [
        { label: 'zsh', text: 'ready http://localhost:5173' },
        { label: 'zsh 2', text: 'http://localhost:3000 http://localhost:5173' },
      ],
      [
        { label: 'dev', port: 5173 },
        { label: 'no-port', port: null },
      ],
    )
    expect(list.map(p => p.port)).toEqual([3000, 5173])
    expect(list[1].sources.map(s => s.label)).toEqual(['dev', 'zsh', 'zsh 2'])
    expect(list[1].url).toBe('http://localhost:5173')
  })
  it('服务端口超范围时忽略', () => {
    expect(mergePorts([], [{ label: 'x', port: 0 }])).toEqual([])
  })
})
