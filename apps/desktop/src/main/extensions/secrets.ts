import { join } from 'node:path'
import type { McpConfig } from '@pixelsky/protocol'
import { MASKED_SECRET } from '@pixelsky/engine'
import { SecureStore, type Cipher } from '../core/secure-store'
export type { Cipher } from '../core/secure-store'
/** MCP 的 env / headers 值：加密存在 extensions/secrets.json，配置文件里只留 MASKED_SECRET */
export class Secrets {
  private readonly store: SecureStore
  constructor(dir: string, cipher: Cipher) {
    this.store = new SecureStore(join(dir, 'secrets.json'), cipher)
  }
  get warning(): string | null {
    return this.store.warning
  }
  get persistent(): boolean {
    return this.store.persistent
  }
  put(id: string, config: McpConfig): McpConfig {
    const values: Record<string, string> = {}
    const old = this.store.get(id)
    const map = (group: 'env' | 'headers'): Record<string, string> =>
      Object.fromEntries(
        Object.entries(config[group] ?? {}).map(([key, value]) => {
          const name = group + ':' + key,
            resolved = value === MASKED_SECRET ? old?.[name] : value
          if (resolved === undefined) throw new Error('凭据已失效，请重新填写 ' + key)
          values[name] = resolved
          return [key, MASKED_SECRET]
        }),
      )
    const redacted = { ...config, env: map('env'), headers: map('headers') }
    this.store.set(id, values)
    return redacted
  }
  resolve(id: string, config: McpConfig): McpConfig {
    const saved = this.store.get(id)
    const map = (group: 'env' | 'headers'): Record<string, string> =>
      Object.fromEntries(
        Object.entries(config[group] ?? {}).map(([key, value]) => {
          if (value !== MASKED_SECRET) return [key, value]
          const found = saved?.[group + ':' + key]
          if (found === undefined) throw new Error('凭据未保存，请重新填写 ' + key)
          return [key, found]
        }),
      )
    return { ...config, env: map('env'), headers: map('headers') }
  }
  remove(id: string): void {
    this.store.remove(id)
  }
  /** 这一项现在存的值（配置保存失败时用 restore 放回去） */
  snapshot(id: string): Readonly<Record<string, string>> | undefined {
    return this.store.get(id)
  }
  restore(id: string, values: Readonly<Record<string, string>> | undefined): void {
    if (values) this.store.set(id, { ...values })
    else this.store.remove(id)
  }
}
