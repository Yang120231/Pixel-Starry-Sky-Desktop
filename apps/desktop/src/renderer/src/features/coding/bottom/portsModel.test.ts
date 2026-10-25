import { describe, expect, it } from 'vitest'
import { findPorts, isPortUrl, mergePorts, parsePort, sameService } from './portsModel'

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

describe('parsePort', () => {
  it('只收 1–65535 的整数', () => {
    expect(parsePort(' 8080 ')).toBe(8080)
    expect(parsePort('65535')).toBe(65535)
    for (const bad of ['', '0', '65536', '80.5', '-1', '80a', '１２３', 'localhost:80'])
      expect(parsePort(bad), bad).toBeNull()
  })
})

describe('sameService', () => {
  it('同协议同主机端口算同一个服务，路径不同也算', () => {
    expect(sameService('http://localhost:5173/about', 'http://localhost:5173')).toBe(true)
    expect(sameService('http://localhost:5173/', 'http://localhost:5174')).toBe(false)
  })
  it('file:// 和打不开的地址不算', () => {
    expect(sameService('file:///a/b.html', 'file:///a/c.html')).toBe(false)
    expect(sameService('not a url', 'http://localhost:1')).toBe(false)
  })
})

describe('isPortUrl', () => {
  it('只认 portUrl 拼出来的无路径地址，带路径的（健康检查）不算', () => {
    expect(isPortUrl('http://localhost:3000')).toBe(true)
    expect(isPortUrl('http://127.0.0.1:3000/health')).toBe(false)
    expect(isPortUrl('http://localhost:3000/health')).toBe(false)
  })
})
