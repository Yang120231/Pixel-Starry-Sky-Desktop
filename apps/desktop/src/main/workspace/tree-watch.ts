// 文件树自动刷新的本机目录监听（docs/ui/file-tree-auto-refresh.md §2 B）：每个根目录一个递归 fs.watch，多个订阅共用；
// 变化停下 500ms（连续变化最多 2 秒）后，按订阅把相对路径换成树里的路径（附加文件夹带「::N/」）推一次
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { isAbsolute, sep } from 'node:path'
import type { TreeChange } from '../../shared/types/workspace'

export type { TreeChange }

/** 一次最多带这么多路径，再多就让树整棵重读（npm install 这类一次改几万个文件） */
export const CHANGE_LIMIT = 1000
const QUIET_MS = 500
const MAX_WAIT_MS = 2000

/** .git 里会改变分支 / 暂存状态的几处；对象、日志、锁文件这些不算 */
const GIT_STATE = /^\.git\/(?:HEAD|index|packed-refs|refs\/)/

export interface WatchRoot {
  path: string
  /** 树里的路径前缀：主文件夹 ''，附加文件夹 '::N' */
  prefix: string
}

type Watch = (path: string, listener: (event: string, filename: string | null) => void) => FSWatcher

interface Pending {
  added: Set<string>
  changed: Set<string>
  git: boolean
  overflow: boolean
}

interface Root {
  watcher: FSWatcher | null
  subscribers: Set<Subscriber>
}

interface Subscriber {
  roots: WatchRoot[]
  emit: (change: TreeChange) => void
  pending: Pending | null
  quiet: ReturnType<typeof setTimeout> | null
  deadline: ReturnType<typeof setTimeout> | null
}

const rootKey = (path: string): string =>
  process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path

const defaultWatch: Watch = (path, listener) =>
  fsWatch(path, { recursive: true, persistent: false }, (event, filename) =>
    listener(event, filename == null ? null : String(filename)),
  )

export function createTreeWatcher(options: { watch?: Watch; quietMs?: number; maxWaitMs?: number } = {}) {
  const watch = options.watch ?? defaultWatch
  const quietMs = options.quietMs ?? QUIET_MS,
    maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS
  const roots = new Map<string, Root>()

  const flush = (sub: Subscriber): void => {
    if (sub.quiet) clearTimeout(sub.quiet)
    if (sub.deadline) clearTimeout(sub.deadline)
    sub.quiet = sub.deadline = null
    const p = sub.pending
    sub.pending = null
    if (!p) return
    sub.emit(
      p.overflow
        ? { added: [], changed: [], git: true, overflow: true }
        : { added: [...p.added], changed: [...p.changed], git: p.git, overflow: false },
    )
  }

  const record = (sub: Subscriber, root: WatchRoot, event: string, filename: string | null): void => {
    const p = (sub.pending ??= { added: new Set(), changed: new Set(), git: false, overflow: false })
    if (filename === null) p.overflow = true
    else {
      const rel = filename.split(sep).join('/')
      // 嵌套仓库的 .git 也不算；锁文件（别人跑 git status 时建了又删）不算
      if (rel.split('/').includes('.git')) {
        if (!GIT_STATE.test(rel) || rel.endsWith('.lock')) return
        p.git = true
      } else {
        const path = root.prefix ? (rel ? `${root.prefix}/${rel}` : root.prefix) : rel
        ;(event === 'rename' ? p.added : p.changed).add(path)
        if (p.added.size + p.changed.size > CHANGE_LIMIT) p.overflow = true
      }
    }
    if (sub.quiet) clearTimeout(sub.quiet)
    sub.quiet = setTimeout(() => flush(sub), quietMs)
    sub.deadline ??= setTimeout(() => flush(sub), maxWaitMs)
  }

  const open = (root: WatchRoot): Root => {
    const key = rootKey(root.path)
    const entry = roots.get(key)
    if (entry) return entry
    const created: Root = { watcher: null, subscribers: new Set() }
    // 关掉并移出表：之后订阅的会重新开（根目录删了又建回来）；树照旧按焦点 / 一轮结束刷新
    const stop = (): void => {
      created.watcher?.close()
      created.watcher = null
      if (roots.get(key) === created) roots.delete(key)
    }
    try {
      created.watcher = watch(root.path, (event, filename) => {
        // Windows 上根目录被删不报 error，而是不停地报根目录自己的完整路径（每秒几十万次）
        if (filename && isAbsolute(filename)) return stop()
        for (const sub of created.subscribers)
          for (const r of sub.roots) if (rootKey(r.path) === key) record(sub, r, event, filename)
      })
      created.watcher.on('error', stop)
      roots.set(key, created)
    } catch {
      /* 开不起来（目录不在、没权限）：这次不监听 */
    }
    return created
  }

  return {
    /** 订阅这些根目录的变化；返回退订。最后一个订阅退掉时关掉监听（Windows 上监听开着会占住目录） */
    subscribe(list: readonly WatchRoot[], emit: (change: TreeChange) => void): () => void {
      const sub: Subscriber = { roots: [...list], emit, pending: null, quiet: null, deadline: null }
      const opened = [...new Set(list.map(r => rootKey(r.path)))].map(key => {
        const entry = open(list.find(r => rootKey(r.path) === key)!)
        entry.subscribers.add(sub)
        return [key, entry] as const
      })
      return () => {
        if (sub.quiet) clearTimeout(sub.quiet)
        if (sub.deadline) clearTimeout(sub.deadline)
        sub.pending = null
        for (const [key, entry] of opened) {
          entry.subscribers.delete(sub)
          if (entry.subscribers.size || roots.get(key) !== entry) continue
          entry.watcher?.close()
          roots.delete(key)
        }
      }
    },
  }
}
