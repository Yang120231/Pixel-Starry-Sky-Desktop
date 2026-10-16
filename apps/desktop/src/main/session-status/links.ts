// 对话里出现过的 PR 链接，记到 userData/session-status/prs.json（每个对话最多 10 个，新的挤掉旧的）。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const MAX_LINKS_PER_SESSION = 10

export class PrLinkStore {
  private data: Record<string, string[]> = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown
      if (!raw || typeof raw !== 'object') return
      for (const [id, urls] of Object.entries(raw))
        if (Array.isArray(urls))
          this.data[id] = urls.filter((u): u is string => typeof u === 'string').slice(-MAX_LINKS_PER_SESSION)
    } catch {
      /* 没有文件或损坏：从空的开始 */
    }
  }

  get(sessionId: string): string[] {
    return this.data[sessionId] ?? []
  }

  /** 记下新链接；返回是否有新增（已有的挪到最新位置，不算新增） */
  add(sessionId: string, urls: string[]): boolean {
    const before = this.get(sessionId)
    const list = [...before]
    let added = false
    for (const url of urls) {
      const at = list.findIndex(u => u.toLowerCase() === url.toLowerCase())
      if (at >= 0) list.splice(at, 1)
      else added = true
      list.push(url)
    }
    const next = list.slice(-MAX_LINKS_PER_SESSION)
    if (next.join('\n') === before.join('\n')) return false
    this.data[sessionId] = next
    this.save()
    return added
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
