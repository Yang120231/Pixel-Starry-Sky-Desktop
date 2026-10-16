// 侧栏对话状态图标的数据服务（docs/ui/sidebar-status-icons.md §4）：工作文件夹还在不在、对话关联的 GitHub PR。
// 不依赖 Electron：会话列表、git、gh、网络、时钟都从 deps 注入（接线在 index.ts）。只读，不改远端；出错只记日志。
import type { SessionPr, SessionStatusState } from '../../shared/types/session-status'
import { describeError, logger } from '@pixelsky/engine'
import { findMissingFolders, localSessions, type SessionLite } from './folders'
import type { GhResult, GhRunner } from './gh'
import {
  GH_PR_FIELDS,
  arrangePrs,
  extractPrUrls,
  mapGhPr,
  mapRestPr,
  parseGithubRemote,
  parsePrUrl,
  unknownPr,
  type RepoRef,
} from './github'

const log = logger('session-status')

export interface RestResponse {
  status: number
  body: unknown
}

export interface PrLinks {
  get(sessionId: string): string[]
  add(sessionId: string, urls: string[]): boolean
  retain(keep: ReadonlySet<string>): void
}

export interface StatusDeps {
  /** 当前所有对话（含远程机器的；本服务自己筛本机、没归档的） */
  sessions(): SessionLite[]
  /** 文件夹在不在；不传用 fs.stat */
  folderExists?: (path: string) => Promise<boolean>
  /** 在 cwd 里跑 git，成功返回去掉首尾空白的输出，失败 null */
  git(cwd: string, args: string[]): Promise<string | null>
  runGh: GhRunner
  /** GET 一个 GitHub 接口地址；网络出错返回 null */
  fetchJson(url: string): Promise<RestResponse | null>
  links: PrLinks
  broadcast(state: SessionStatusState): void
  now(): number
}

/** 一轮最多查多少个（分支 + 链接）；没登录 gh 时 GitHub 公开接口每小时只给 60 次 */
export const LOOKUPS_PER_CYCLE = 30
const GH_RECHECK_MS = 5 * 60_000
const GH_TTL_MS = 30_000
const REST_TTL_MS = 5 * 60_000
/** 手动刷新时公开接口缓存的最短保留，免得连点把额度用光 */
const REST_FORCED_TTL_MS = 60_000
/** 公开接口被限流 / 拒绝后，这么久不再请求 */
const REST_BLOCK_MS = 10 * 60_000
const CONCURRENCY = 4

interface BranchInfo extends RepoRef {
  branch: string
}

interface Scope {
  all: boolean
  ids: Set<string>
  force: boolean
}

export class SessionStatusService {
  private missing: Record<string, true> = {}
  private prs: Record<string, SessionPr[]> = {}
  private gh: SessionStatusState['gh'] = 'missing'
  private ghCheckedAt = -Infinity
  private restBlockedUntil = 0
  private lastBroadcast = ''
  private readonly cache = new Map<string, { at: number; value: SessionPr[] | SessionPr | null }>()
  private pending: Scope | null = null
  private running: Promise<void> | null = null
  private foldersRunning = false
  private foldersAgain = false
  private foldersSig: string | null = null
  private prsSig: string | null = null
  lastPrRefresh = -Infinity
  private lastFoldersRefresh = -Infinity

  constructor(private readonly deps: StatusDeps) {}

  state(): SessionStatusState {
    return { missingFolders: this.missing, prs: this.prs, gh: this.gh }
  }

  // ---- 对话列表变了：只在「有哪些对话 / 在哪个文件夹」变了时才重查 ----

  /** 返回要重查文件夹 / PR 吗 */
  sessionsChanged(): { folders: boolean; prs: boolean } {
    const local = localSessions(this.deps.sessions())
    const sig = local
      .map(s => `${s.id}\t${s.cwd}`)
      .sort()
      .join('\n')
    const folders = sig !== this.foldersSig,
      prs = sig !== this.prsSig
    this.foldersSig = this.prsSig = sig
    return { folders, prs }
  }

  // ---- 文件夹 ----

  async refreshFolders(): Promise<void> {
    if (this.foldersRunning) {
      this.foldersAgain = true
      return
    }
    this.foldersRunning = true
    try {
      do {
        this.foldersAgain = false
        try {
          this.missing = await findMissingFolders(localSessions(this.deps.sessions()), this.deps.folderExists)
          this.lastFoldersRefresh = this.deps.now()
          this.publish()
        } catch (error) {
          log.warn('检查工作文件夹失败', { error: describeError(error) })
        }
      } while (this.foldersAgain)
    } finally {
      this.foldersRunning = false
    }
  }

  get lastFolders(): number {
    return this.lastFoldersRefresh
  }

  // ---- PR ----

  /** 对话里出现了 PR 链接：记下来；有新的返回 true */
  noteLinks(sessionId: string, text: string): boolean {
    const links = extractPrUrls(text)
    return (
      links.length > 0 &&
      this.deps.links.add(
        sessionId,
        links.map(l => l.url),
      )
    )
  }

  /** 重查 PR：sessionId 不传查全部；force 忽略缓存（手动刷新） */
  refreshPrs(sessionId?: string, force = false): Promise<void> {
    const next = this.pending ?? { all: false, ids: new Set<string>(), force: false }
    if (sessionId === undefined) next.all = true
    else next.ids.add(sessionId)
    next.force ||= force
    this.pending = next
    if (!this.running) {
      this.running = this.drain().finally(() => (this.running = null))
    }
    return this.running
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const scope = this.pending
      this.pending = null
      try {
        await this.prPass(scope)
      } catch (error) {
        log.warn('查询 PR 失败', { error: describeError(error) })
      }
    }
  }

  private async prPass(scope: Scope): Promise<void> {
    const now = this.deps.now()
    const all = localSessions(this.deps.sessions())
    const targets = scope.all ? all : all.filter(s => scope.ids.has(s.id))
    const gh = await this.ensureGh()
    const ctx = {
      force: scope.force,
      left: LOOKUPS_PER_CYCLE,
      inflight: new Map<string, Promise<unknown>>(),
      ready: gh === 'ready',
    }
    const infos = new Map<string, Promise<BranchInfo | null>>()
    const result: Record<string, SessionPr[]> = {}

    const one = async (s: SessionLite): Promise<void> => {
      const list: SessionPr[] = []
      if (!this.missing[s.id]) {
        let info = infos.get(s.cwd)
        if (!info) infos.set(s.cwd, (info = this.branchInfo(s.cwd)))
        const b = await info
        if (b) list.push(...((await this.lookupBranch(b, ctx)) ?? []))
      }
      for (const url of this.deps.links.get(s.id)) {
        const pr = await this.lookupUrl(url, ctx)
        if (pr) list.push(pr)
      }
      const arranged = arrangePrs(list, now)
      if (arranged.length) result[s.id] = arranged
    }
    await pool(targets, CONCURRENCY, one)

    const next: Record<string, SessionPr[]> = {}
    const targetIds = new Set(targets.map(s => s.id))
    // 没查的对话保留原来的；查了的用新结果；不在列表里的去掉
    for (const s of all) {
      const value = targetIds.has(s.id) ? result[s.id] : this.prs[s.id]
      if (value?.length) next[s.id] = value
    }
    this.prs = next
    this.lastPrRefresh = this.deps.now()
    this.publish()
  }

  /** 分支、origin 地址、默认分支；detached、默认分支、非 GitHub 返回 null */
  private async branchInfo(cwd: string): Promise<BranchInfo | null> {
    try {
      const branch = await this.deps.git(cwd, ['branch', '--show-current'])
      if (!branch) return null
      const remote = await this.deps.git(cwd, ['remote', 'get-url', 'origin'])
      const repo = remote ? parseGithubRemote(remote) : null
      if (!repo) return null
      const head = await this.deps.git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      const base = head ? head.replace(/^origin\//, '') : null
      if (base ? branch === base : branch === 'main' || branch === 'master') return null
      return { ...repo, branch }
    } catch (error) {
      log.debug('读取分支失败', { error: describeError(error) })
      return null
    }
  }

  private async ensureGh(): Promise<SessionStatusState['gh']> {
    const now = this.deps.now()
    if (now - this.ghCheckedAt < GH_RECHECK_MS) return this.gh
    this.ghCheckedAt = now
    let next: SessionStatusState['gh']
    try {
      const r = await this.deps.runGh(['auth', 'status'])
      next = r.missing ? 'missing' : r.code === 0 ? 'ready' : 'signed-out'
    } catch {
      next = 'missing'
    }
    this.gh = next
    return next
  }

  private fresh(key: string, ready: boolean, force: boolean): { hit: boolean; value: SessionPr[] | SessionPr | null } {
    const c = this.cache.get(key)
    if (!c) return { hit: false, value: null }
    const ttl = ready ? (force ? 0 : GH_TTL_MS) : force ? REST_FORCED_TTL_MS : REST_TTL_MS
    return { hit: this.deps.now() - c.at < ttl, value: c.value }
  }

  /** 缓存 + 每轮预算 + 同一轮内同一个 key 只查一次；查失败（null）时沿用旧缓存 */
  private async cached<T extends SessionPr[] | SessionPr>(
    key: string,
    ctx: Ctx,
    load: () => Promise<T | null>,
  ): Promise<T | null> {
    const f = this.fresh(key, ctx.ready, ctx.force)
    if (f.hit) return f.value as T
    const shared = ctx.inflight.get(key)
    if (shared) return (await shared) as T | null
    if (ctx.left <= 0) return f.value as T | null
    ctx.left--
    const job = load()
      .then(value => {
        if (value) this.cache.set(key, { at: this.deps.now(), value })
        return value ?? (f.value as T | null)
      })
      .catch(error => {
        log.warn('查询 PR 出错', { error: describeError(error) })
        return f.value as T | null
      })
    ctx.inflight.set(key, job)
    return job
  }

  private lookupBranch(b: BranchInfo, ctx: Ctx): Promise<SessionPr[] | null> {
    const repo = `${b.owner}/${b.repo}`
    return this.cached<SessionPr[]>(`b:${repo}#${b.branch}`.toLowerCase(), ctx, async () => {
      if (ctx.ready) {
        const r = await this.deps.runGh([
          'pr',
          'list',
          '--repo',
          repo,
          '--head',
          b.branch,
          '--state',
          'all',
          '--limit',
          '5',
          '--json',
          GH_PR_FIELDS,
        ])
        return ghList(r, repo)
      }
      const res = await this.rest(
        `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(`${b.owner}:${b.branch}`)}&state=all&per_page=5`,
      )
      if (!res || res.status !== 200 || !Array.isArray(res.body)) return null
      return res.body.map(x => mapRestPr(x, repo)).filter((x): x is SessionPr => !!x)
    })
  }

  private async lookupUrl(url: string, ctx: Ctx): Promise<SessionPr | null> {
    const link = parsePrUrl(url)
    if (!link) return null
    const pr = await this.cached<SessionPr>(`u:${link.url}`.toLowerCase(), ctx, async () => {
      if (ctx.ready) {
        const r = await this.deps.runGh(['pr', 'view', link.url, '--json', GH_PR_FIELDS])
        if (r.code !== 0) return null
        try {
          return mapGhPr(JSON.parse(r.stdout) as unknown, `${link.owner}/${link.repo}`)
        } catch {
          return null
        }
      }
      const res = await this.rest(`https://api.github.com/repos/${link.owner}/${link.repo}/pulls/${link.number}`)
      return res?.status === 200 ? mapRestPr(res.body, `${link.owner}/${link.repo}`) : null
    })
    // 查不到（私有仓库没登录 gh、限流、链接失效）：只留一个「有这个 PR」的占位
    return pr ?? unknownPr(link)
  }

  /** 公开接口：被拒绝 / 限流后一段时间不再请求 */
  private async rest(url: string): Promise<RestResponse | null> {
    if (this.deps.now() < this.restBlockedUntil) return null
    const res = await this.deps.fetchJson(url)
    if (res && (res.status === 403 || res.status === 429)) this.restBlockedUntil = this.deps.now() + REST_BLOCK_MS
    return res
  }

  // ---- 推送：只有内容真的变了才广播 ----

  private publish(): void {
    const state = this.state()
    const json = JSON.stringify(state)
    if (json === this.lastBroadcast) return
    this.lastBroadcast = json
    try {
      this.deps.broadcast(state)
    } catch (error) {
      log.warn('推送状态失败', { error: describeError(error) })
    }
  }
}

interface Ctx {
  force: boolean
  left: number
  inflight: Map<string, Promise<unknown>>
  ready: boolean
}

function ghList(r: GhResult, repo: string): SessionPr[] | null {
  if (r.code !== 0) return null
  try {
    const list = JSON.parse(r.stdout) as unknown
    if (!Array.isArray(list)) return null
    return list.map(x => mapGhPr(x, repo)).filter((x): x is SessionPr => !!x)
  } catch {
    return null
  }
}

/** 最多同时 limit 个 */
async function pool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}
