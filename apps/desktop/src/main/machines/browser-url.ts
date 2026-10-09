const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
export function remoteBrowserPort(url: string): number | null {
  const parsed = new URL(url)
  return loopback.has(parsed.hostname) ? Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) : null
}
export function browserTunnelUrl(url: string, port: number): string {
  const parsed = new URL(url)
  parsed.hostname = '127.0.0.1'; parsed.port = String(port)
  return parsed.href
}
/** Preserve paths/query/hash after in-page navigation, exposing the remote address to the user. */
export function browserRemoteUrl(url: string, original: string, tunnel: string): string | null {
  const parsed = new URL(url), transport = new URL(tunnel), remote = new URL(original)
  if (parsed.origin !== transport.origin) return null
  remote.pathname = parsed.pathname; remote.search = parsed.search; remote.hash = parsed.hash
  return remote.href
}
