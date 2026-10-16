import { codedError, isExtId, isExtVersion } from '@pixelsky/protocol'
import type { ExtStoreReportReason } from '@pixelsky/protocol'
import { object } from '@pixelsky/engine'
import * as ipc from '../../ipc/guard'
import type { AppContext } from '../../app/context'
import { baseUrl } from '../../account/account'
import type { ExtensionPacks } from '../service'

// 扩展商店的主进程一侧（docs/ui/extension-store-client.md §3.10）。
// 现在是骨架：只读通道回空数据，会写的通道参数检查完回 extstore.notImplemented，后面的切片逐个接上真实现。

const NAME_MAX = 64
const TOKEN_MAX = 200
const QUERY_MAX = 100
const REPORT_DETAIL_MAX = 2000
/** 拖进来的 zip 最多 10 MB + 1 字节（多 1 字节用来判断超了） */
const UPLOAD_MAX = 10 * 1024 * 1024 + 1
const REPORT_REASONS: readonly ExtStoreReportReason[] = [
  'malicious',
  'broken',
  'copyright',
  'inappropriate',
  'misleading',
  'other',
]
const SORTS = ['recommended', 'downloads', 'newest']

function str(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0'))
    throw codedError('extstore.badRequest')
  return value
}

/** 扩展 id 和版本号按协议包的格式规则检查（和云端一致） */
const idArg = (value: unknown): string => {
  if (!isExtId(value)) throw codedError('extstore.badRequest')
  return value
}
const versionArg = (value: unknown): string => {
  if (!isExtVersion(value)) throw codedError('extstore.badRequest')
  return value
}

function optionalStr(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw codedError('extstore.badRequest')
  return value
}

function catalogQuery(raw: unknown): void {
  const q = object(raw)
  optionalStr(q.q, QUERY_MAX * 4) // 云端按 100 字截断，这里放宽到不会误拒，只防过大的参数
  optionalStr(q.category, 40)
  const sort = optionalStr(q.sort, 20)
  if (sort !== undefined && !SORTS.includes(sort)) throw codedError('extstore.badRequest')
  optionalStr(q.before, 40)
}

function reportInput(raw: unknown): void {
  const input = object(raw)
  if (typeof input.reason !== 'string' || !REPORT_REASONS.includes(input.reason as ExtStoreReportReason))
    throw codedError('extstore.badRequest')
  if (typeof input.detail !== 'string' || input.detail.length > REPORT_DETAIL_MAX)
    throw codedError('extstore.badRequest')
  versionArg(input.version)
}

/** null 弹选择框；{ bytes, name } 是拖进来的 zip。传字符串（路径）一律拒绝 */
function pickUploadInput(raw: unknown): void {
  if (raw === null) return
  const input = object(raw)
  if (!(input.bytes instanceof ArrayBuffer) || input.bytes.byteLength > UPLOAD_MAX) {
    if (input.bytes instanceof ArrayBuffer) throw codedError('extstore.tooLarge')
    throw codedError('extstore.badRequest')
  }
  str(input.name, 260)
}

/** 扩展商店的 IPC。service 现在没用到，后面接安装 / 停用名单时用 */
export function initExtStore(_ctx: AppContext, _service: ExtensionPacks): void {
  const todo = (): never => {
    throw codedError('extstore.notImplemented')
  }

  // 只读：回空数据
  ipc.handle('extstore:catalog', (_e, query: unknown) => {
    catalogQuery(query)
    return { items: [], nextBefore: null }
  })
  ipc.handle('extstore:detail', (_e, id: unknown) => {
    idArg(id)
    return null
  })
  ipc.handle('extstore:checkUpdates', () => ({}))
  ipc.handle('extstore:state', () => ({
    site: new URL(baseUrl()).origin,
    updates: {},
    blocklistAt: null,
    installing: {},
  }))
  ipc.handle('extstore:refreshBlocklist', () => ({ blocklistAt: null }))
  ipc.handle('extstore:publisher', () => ({ publisher: null, extensions: [] }))
  ipc.handle('extstore:publishCheck', (_e, id: unknown, version: unknown) => {
    idArg(id)
    versionArg(version)
    return null
  })

  // 会写的：检查参数后回 notImplemented
  ipc.handle('extstore:install', (_e, id: unknown, version: unknown, options: unknown) => {
    idArg(id)
    versionArg(version)
    const rollback = object(options).rollback
    if (rollback !== undefined && typeof rollback !== 'boolean') throw codedError('extstore.badRequest')
    return todo()
  })
  ipc.handle('extstore:cancel', (_e, id: unknown) => {
    idArg(id)
    return todo()
  })
  ipc.handle('extstore:report', (_e, id: unknown, input: unknown) => {
    idArg(id)
    reportInput(input)
    return todo()
  })
  ipc.handle('extstore:register', (_e, name: unknown) => {
    str(name, NAME_MAX)
    return todo()
  })
  ipc.handle('extstore:pickUpload', (_e, input: unknown) => {
    pickUploadInput(input)
    return todo()
  })
  ipc.handle('extstore:upload', (_e, token: unknown) => {
    str(token, TOKEN_MAX)
    return todo()
  })
  ipc.handle('extstore:withdraw', (_e, id: unknown, version: unknown) => {
    idArg(id)
    versionArg(version)
    return todo()
  })
  ipc.handle('extstore:delist', (_e, id: unknown) => {
    idArg(id)
    return todo()
  })
  ipc.handle('extstore:relist', (_e, id: unknown) => {
    idArg(id)
    return todo()
  })
}
