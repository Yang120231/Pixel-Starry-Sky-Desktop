import { expect, it } from 'vitest'
import { browserRemoteUrl, browserTunnelUrl, remoteBrowserPort } from './browser-url'

it('restores a remote loopback address after reconnect chooses another local port', () => {
  const original = 'http://localhost:8080/app?q=1#section'
  const first = browserTunnelUrl(original, 53001), second = browserTunnelUrl(original, 53002)
  expect(second).toBe('http://127.0.0.1:53002/app?q=1#section')
  expect(browserRemoteUrl(first.replace('/app', '/next'), original, first)).toBe('http://localhost:8080/next?q=1#section')
  expect(browserRemoteUrl('https://example.invalid/redirect', original, first)).toBeNull()
  expect(remoteBrowserPort(original)).toBe(8080)
  expect(remoteBrowserPort('https://[::1]/')).toBe(443)
  expect(remoteBrowserPort('https://example.invalid/')).toBeNull()
})
