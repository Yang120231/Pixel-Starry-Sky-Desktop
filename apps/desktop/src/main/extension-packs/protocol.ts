import { readFile, lstat, realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import { protocol } from 'electron'
import { checkSvg, EXT_ASSET_SCHEME, EXT_LIMITS } from '@pixelsky/protocol'
import type { ExtensionPacks } from './service'

/** pixelsky-ext://<扩展 key>/<路径>?v=<版本>：只给 <img> 用的 svg / png，必须在 app ready 之前登记 */
export const EXT_SCHEME_PRIVILEGES: Electron.CustomScheme = {
  scheme: EXT_ASSET_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: false },
}

const status = (code: number): Response => new Response(null, { status: code })

/** file 的真实路径必须落在 root 的真实路径里，且自己不是符号链接 */
async function contained(root: string, file: string): Promise<boolean> {
  try {
    if (!(await lstat(file)).isFile()) return false
    const [r, f] = await Promise.all([realpath(root), realpath(file)])
    return f === r || f.startsWith(r.endsWith(sep) ? r : r + sep)
  } catch {
    return false
  }
}

export function registerPackProtocol(
  service: Pick<ExtensionPacks, 'assetFile'> & Partial<Pick<ExtensionPacks, 'location'>>,
): void {
  protocol.handle(EXT_ASSET_SCHEME, async req => {
    try {
      const url = new URL(req.url)
      const key = url.hostname
      const path = decodeURIComponent(url.pathname.slice(1))
      if (!path || path.includes('\\') || path.includes('\0') || path.split('/').some(s => s === '..'))
        return status(400)
      const asset = await service.assetFile(key, path)
      if (!asset) return status(404)
      // 文件夹扩展：服务端按文件表放行，这里在读取时再核对一次“不是链接、真实路径在扩展目录内”
      const root = service.location?.(key)
      if (root && !(await contained(root, asset.file))) return status(404)
      const buf = await readFile(asset.file)
      if (buf.length > EXT_LIMITS.fileBytes) return status(413)
      if (asset.mime === 'image/svg+xml' && checkSvg(buf.toString('utf8')) !== null) return status(403)
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': asset.mime,
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        },
      })
    } catch {
      return status(500)
    }
  })
}
