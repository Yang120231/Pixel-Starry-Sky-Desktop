// 平台额度的扣费 Key（docs/ui/platform-key-mode.md）：自动（客户端专用的托管 Key，默认）/ 我的 Key（用户自己在网站上建的）。
// 模式存在本机，每个平台请求都带上请求头，云端按它选 Key；云端不存。
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { logger } from '@pixelsky/engine'
import type { PlatformKeyMode } from '../../shared/types/platform-catalog'
import { setPlatformHeaders } from '../account/account'
import * as ipc from '../ipc/guard'

/** 云端认的请求头（services/cloud desktopapi.KeyModeHeader） */
export const KEY_MODE_HEADER = 'X-PixelSky-Key-Mode'

const log = logger('platform')
let mode: PlatformKeyMode = 'auto'

/** 不认识的值都当作默认的自动 */
export function parseKeyMode(value: unknown): PlatformKeyMode {
  return value === 'own' ? 'own' : 'auto'
}

export function keyMode(): PlatformKeyMode {
  return mode
}

/** 读文件；坏了或没有都当作自动 */
export function loadKeyMode(file: string): PlatformKeyMode {
  try {
    return parseKeyMode((JSON.parse(readFileSync(file, 'utf8')) as { mode?: unknown } | null)?.mode)
  } catch {
    return 'auto'
  }
}

function save(file: string, next: PlatformKeyMode): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ mode: next }), { mode: 0o600 })
  renameSync(tmp, file)
}

/** 读本机保存的模式、给平台请求挂上请求头、注册读写的 IPC（initPlatform 调用一次） */
export function initKeyMode(): void {
  const file = join(app.getPath('userData'), 'platform-key-mode.json')
  mode = loadKeyMode(file)
  setPlatformHeaders(() => ({ [KEY_MODE_HEADER]: mode }))
  ipc.handle('platform:keyMode', () => mode)
  ipc.handle(
    'platform:setKeyMode',
    (_e, next: unknown) => {
      if (next !== 'auto' && next !== 'own') throw new Error('无效的扣费 Key 设置')
      if (next !== mode) {
        save(file, next)
        mode = next
        log.info('扣费用的 Key 已切换', { mode })
      }
      return mode
    },
    { deny: '无效的扣费 Key 设置' },
  )
}
