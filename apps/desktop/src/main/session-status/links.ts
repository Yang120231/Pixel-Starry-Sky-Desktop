// 对话里出现过的 PR 链接，记到 userData/session-status/prs.json（docs/ui/sidebar-pr-v2-mockup.html）。
// 分两种：own 是这个对话自己建的（gh pr create 的输出、建 PR 的工具），会查状态、出图标；
// mentioned 只是在输出或回复里出现过（比如看别人仓库的发布说明），不查状态、不出图标，只在悬停卡里折叠列出。
// 每种每个对话最多 10 个，新的挤掉旧的。旧版文件是 { 对话: [链接] }，分不出来，按 mentioned 读
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const MAX_LINKS_PER_SESSION = 10

interface Entry {
  own: string[]
  mentioned: string[]
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string').slice(-MAX_LINKS_PER_SESSION) : []

export class PrLinkStore {
  private data: Record<string, Entry> = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown
      if (!raw || typeof raw !== 'object') return
      for (const [id, value] of Object.entries(raw)) {
        if (Array.isArray(value)) this.data[id] = { own: [], mentioned: strings(value) }
        else if (value && typeof value === 'object') {
          const v = value as Record<string, unknown>
          this.data[id] = { own: strings(v.own), mentioned: strings(v.mentioned) }
        }
      }
    } catch {
      /* 没有文件或损坏：从空的开始 */
    }
  }

  /** 这个对话自己建的 PR 链接 */
  get(sessionId: string): string[] {
    return this.data[sessionId]?.own ?? []
  }

  /** 只是提到过的 PR 链接（不含已经算作自己建的） */
  mentioned(sessionId: string): string[] {
    const e = this.data[sessionId]
    return e ? e.mentioned.filter(u => !e.own.some(o => same(o, u))) : []
  }

  /** 记下新链接；own 是这个对话建的。返回自己建的有没有新增（只有它要去查状态） */
  add(sessionId: string, urls: string[], own = false): boolean {
    const before = this.data[sessionId] ?? { own: [], mentioned: [] }
    const key = own ? 'own' : 'mentioned'
    const list = [...before[key]]
    let added = false
    for (const url of urls) {
      const at = list.findIndex(u => same(u, url))
      if (at >= 0) list.splice(at, 1)
      else added = true
      list.push(url)
    }
    const next = list.slice(-MAX_LINKS_PER_SESSION)
    if (next.join('\n') === before[key].join('\n')) return false
    this.data[sessionId] = { ...before, [key]: next }
    this.save()
    return own && added
  }

  /** 去掉不在 keep 里的对话的记录 */
  retain(keep: ReadonlySet<string>): void {
    let changed = false
    for (const id of Object.keys(this.data))
      if (!keep.has(id)) {
        delete this.data[id]
        changed = true
      }
    if (changed) this.save()
  }

  /** 先写临时文件再改名，写入排队，不会写一半 */
  private save(): void {
    const text = JSON.stringify(this.data)
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true })
        const tmp = `${this.file}.tmp`
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, this.file)
      })
      .catch(() => undefined)
  }

  /** 等排队的写入都落盘（测试、退出时用） */
  flush(): Promise<void> {
    return this.writing
  }
}
