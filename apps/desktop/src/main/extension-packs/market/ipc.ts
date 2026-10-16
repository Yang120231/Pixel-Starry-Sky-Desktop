import { codedError, isExtId, isExtVersion } from '@pixelsky/protocol'
import type {
  ExtStoreDetail,
  ExtStoreLocal,
  ExtStoreReportReason,
  ExtStoreSort,
  ExtStoreState,
} from '@pixelsky/protocol'
import { object } from '@pixelsky/engine'
import * as ipc from '../../ipc/guard'
import type { AppContext } from '../../app/context'
import { baseUrl } from '../../account/account'
import type { ExtensionPacks } from '../service'
import { storeApi, StoreError } from './api'
import { createInstaller } from './install'
import { downloadCapped } from './net'
import type { StoreHost } from './types'
import { AUTO_CHECK_INTERVAL_MS, createUpdates } from './updates'

// 扩展商店的主进程一侧（docs/ui/extension-store-client.md §3.10）。
// 公开通道（目录、详情、安装、取消、检查更新、状态）已接上真实现；要登录的通道（我的发布、举报）还是
// 参数检查完回 extstore.notImplemented，7.5b 接上。停用名单的读取和 refreshBlocklist 是 7.3a。

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
const SORTS = ['recommended', 'downloads', 'updated']

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

/** 本机装的同 id 的那一份：商店 > 文件夹 > 内置（详情页要显示「本机装的版本」） */
function localOf(service: ExtensionPacks, id: string): ExtStoreLocal | null {
  const packs = service.state().packs.filter(p => p.id === id)
  const pick = packs.find(p => p.source === 'store') ?? packs.find(p => p.source === 'folder') ?? packs[0]
  if (!pick) return null
  return {
    key: pick.key,
    version: pick.store?.version ?? pick.manifest?.version ?? null,
    source: pick.source,
    enabled: pick.enabled,
    ...(pick.blocked && { blocked: pick.blocked }),
  }
}

/** 扩展商店的 IPC；service 的方法拼成 StoreHost 交给 installer（install.ts 自己拿不到 service） */
export function initExtStore(ctx: AppContext, service: ExtensionPacks): void {
  const todo = (): never => {
    throw codedError('extstore.notImplemented')
  }
  const site = (): string => new URL(baseUrl()).origin
  const changed = (): void => ctx.events.broadcast('extstore:changed')

  const host: StoreHost = {
    mutate: fn => service.runExclusive(fn),
    replaceStorePack: (record, root) => service.replaceStorePack(record, root),
    removeStorePack: id => service.removeStorePack(id),
    storeInfo: id => service.storeInfo(id),
    appVersion: service.opts.appVersion,
    storeDir: service.storeDir,
    ready: () => service.ready(),
    packs: () => service.state().packs,
  }
  const blocked = (s: string, id: string, version: string) => service.storeBlocked(s, id, version)
  const installer = createInstaller({
    host,
    api: storeApi,
    net: { downloadCapped },
    site,
    blocked,
    onChange: changed,
  })
  service.attachStoreTasks({ cancel: id => installer.cancel(id) })
  const updates = createUpdates({
    api: storeApi,
    site,
    packs: host.packs,
    appVersion: host.appVersion,
    blocked,
    onChange: changed,
  })
  // 启动时静默安装 BOOTSTRAP_PACKS（默认空，什么都不做）；不 await，失败只写日志
  void installer.bootstrap().catch(e => console.warn('[extension-store] bootstrap failed', e))

  ipc.handle('extstore:catalog', (_e, query: unknown) => {
    catalogQuery(query)
    const q = object(query)
    return storeApi.catalog({
      q: optionalStr(q.q, QUERY_MAX * 4),
      category: optionalStr(q.category, 40),
      sort: optionalStr(q.sort, 20) as ExtStoreSort | undefined,
      before: optionalStr(q.before, 40),
    })
  })
  ipc.handle('extstore:detail', async (_e, id: unknown): Promise<ExtStoreDetail | null> => {
    const detail = await storeApi.detail(idArg(id)).catch(e => {
      // 下架或停用后详情 404：回 null，渲染层显示本机那份
      if (e instanceof StoreError && e.status === 404) return null
      throw e
    })
    return detail && { ...detail, local: localOf(service, detail.extension.id) }
  })
  // 参数 { auto:true } 是打开扩展页时的自动检查：距上次查完不到 10 分钟就直接回上次的结果；不带参数（点「检查更新」）立刻查
  ipc.handle('extstore:checkUpdates', (_e, options: unknown) => {
    const auto = options === undefined || options === null ? undefined : object(options).auto
    if (auto !== undefined && typeof auto !== 'boolean') throw codedError('extstore.badRequest')
    return updates.check(auto ? { maxAgeMs: AUTO_CHECK_INTERVAL_MS } : {})
  })
  ipc.handle(
    'extstore:state',
    (): ExtStoreState => ({
      site: site(),
      updates: updates.last(),
      blocklistAt: service.blocklistAt(site()),
      installing: installer.installing(),
    }),
  )
  ipc.handle('extstore:refreshBlocklist', () => ({ blocklistAt: service.blocklistAt(site()) }))
  ipc.handle('extstore:publisher', () => ({ publisher: null, extensions: [] }))
  ipc.handle('extstore:publishCheck', (_e, id: unknown, version: unknown) => {
    idArg(id)
    versionArg(version)
    return null
  })

  // 会写的：检查参数后回 notImplemented
  ipc.handle('extstore:install', (_e, id: unknown, version: unknown, options: unknown) => {
    const rollback = object(options).rollback
    if (rollback !== undefined && typeof rollback !== 'boolean') throw codedError('extstore.badRequest')
    return installer.install(idArg(id), versionArg(version), { rollback: rollback === true })
  })
  ipc.handle('extstore:cancel', (_e, id: unknown) => installer.cancel(idArg(id)))
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
