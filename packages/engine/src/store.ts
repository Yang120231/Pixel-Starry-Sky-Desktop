// 项目、会话记录、对话条目的保存（docs/engines.md §8）
//
// <dataDir>/projects.json              项目列表
// <dataDir>/engine-settings.json       新会话默认设置、各引擎的路径 / 环境变量 / 默认值 / 选项
// <dataDir>/sessions/<id>/record.json  会话记录
// <dataDir>/sessions/<id>/items.jsonl  对话条目，每行一个，只追加：开始时写一次，完成（或一轮结束收尾）时再写一次，
//                                      读出时同一 id 取第一次的位置、最后一次的内容
//
// 写入都是同步的小文件操作：保证顺序，量也很小（只在条目开始 / 完成时写，不写流式增量）。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type {
  EngineDefaults,
  EngineId,
  Item,
  ProjectRecord,
  QueueSummary,
  SessionDefaults,
  SessionRecord,
} from '@pixelsky/protocol'
import { messageInput, type QueueFile } from './queue'
import { retryLimit } from './retry'

const VERSION = 1

export interface EngineSettingsFile {
  maxRetries: number | null
  defaults: EngineDefaults
  /** 各引擎替换的命令：绝对路径或 PATH 上的命令名（docs/ui/engine-launch.md） */
  paths: Partial<Record<EngineId, string>>
  /** 各引擎追加的环境变量 */
  env: Partial<Record<EngineId, Record<string, string>>>
  /** 各引擎压缩上下文用的模型 */
  compactModels: Partial<Record<EngineId, string>>
  /** 各引擎的新会话默认值；没有时用 defaults 里的（旧版只有一份全局默认，docs/ui/engine-settings-redesign.md §4） */
  engineDefaults: Partial<Record<EngineId, SessionDefaults>>
  /** 各引擎的对话 / 上下文 / 菜单选项 */
  options: Partial<Record<EngineId, EngineOptions>>
}

/** 设置 › 本机引擎 › 详情里的引擎级选项；没写的项用默认值 */
export interface EngineOptions {
  outputStyle?: string
  /** 只存 false（关掉提问） */
  askQuestions?: boolean
  autoCompactPct?: number
  hidden?: boolean
  /** 每次启动引擎进程时追加的参数（docs/ui/engine-launch.md）；只存非空 */
  args?: string[]
}

export const DEFAULT_SETTINGS: EngineSettingsFile = {
  maxRetries: null,
  defaults: {
    engine: 'claude',
    model: null,
    effort: 'high',
    permissionMode: 'edits',
    ultracode: false,
    fast: false,
    thinkingSummaries: true,
  },
  paths: {},
  env: {},
  compactModels: {},
  engineDefaults: {},
  options: {},
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * 改名替换目标文件。Windows 上目标正被别的句柄打开（同时在读、杀毒软件扫描）时会短暂报 EPERM / EBUSY / EACCES，
 * 稍等几毫秒重试即可；重试几次还不行再抛出。
 */
function replaceFile(tmp: string, file: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1))
    }
  }
}

/** 先写临时文件再改名，写到一半断电也不会留下坏文件 */
function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  replaceFile(tmp, file)
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/

export class Store {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'sessions'), { recursive: true })
  }

  private sessionDir(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error(`会话 id 不合法：${id}`)
    return join(this.dir, 'sessions', id)
  }

  loadProjects(): ProjectRecord[] {
    const data = readJson<{ projects?: ProjectRecord[] }>(join(this.dir, 'projects.json'))
    return Array.isArray(data?.projects) ? data.projects : []
  }

  saveProjects(projects: ProjectRecord[]): void {
    writeJson(join(this.dir, 'projects.json'), { version: VERSION, projects })
  }

  loadSettings(): EngineSettingsFile {
    const data = readJson<Partial<EngineSettingsFile>>(join(this.dir, 'engine-settings.json'))
    let maxRetries: number | null = null
    try {
      maxRetries = retryLimit(data?.maxRetries ?? null)
    } catch {
      /* 旧文件或损坏值恢复跟随引擎 */
    }
    return {
      maxRetries,
      defaults: { ...DEFAULT_SETTINGS.defaults, ...(data?.defaults ?? {}) },
      paths: { ...(data?.paths ?? {}) },
      env: { ...(data?.env ?? {}) },
      compactModels: { ...(data?.compactModels ?? {}) },
      engineDefaults: { ...(data?.engineDefaults ?? {}) },
      options: { ...(data?.options ?? {}) },
    }
  }

  saveSettings(settings: EngineSettingsFile): void {
    writeJson(join(this.dir, 'engine-settings.json'), { version: VERSION, ...settings })
  }

  loadRecords(): SessionRecord[] {
    const out: SessionRecord[] = []
    let names: string[]
    try {
      names = readdirSync(join(this.dir, 'sessions'))
    } catch {
      return out
    }
    for (const name of names) {
      if (!SAFE_ID.test(name)) continue
      const rec = readJson<SessionRecord>(join(this.dir, 'sessions', name, 'record.json'))
      // 旧版本保存的记录没有 ultracode 字段
      if (rec && rec.id === name) {
        out.push({
          ...rec,
          bottomedAt:
            typeof rec.bottomedAt === 'number' && Number.isFinite(rec.bottomedAt) && rec.bottomedAt > 0
              ? rec.bottomedAt
              : null,
          titleEdited: rec.titleEdited === true,
          archivedAt: typeof rec.archivedAt === 'number' && Number.isFinite(rec.archivedAt) ? rec.archivedAt : null,
          ultracode: rec.ultracode === true,
          fast: rec.fast === true,
          thinkingSummaries: rec.thinkingSummaries !== false,
        })
      }
    }
    return out
  }

  saveRecord(record: SessionRecord): void {
    const dir = this.sessionDir(record.id)
    mkdirSync(dir, { recursive: true })
    writeJson(join(dir, 'record.json'), record)
  }

  appendItem(sessionId: string, item: Item): void {
    const dir = this.sessionDir(sessionId)
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'items.jsonl'), JSON.stringify(item) + '\n', 'utf8')
  }

  loadQueue(record: SessionRecord): QueueFile {
    const raw = readJson<QueueFile & { version?: number }>(join(this.sessionDir(record.id), 'queue.json'))
    if (!raw || raw.version !== 1 || !Array.isArray(raw.items)) return { items: [], paused: false, receipts: [] }
    const items = raw.items.flatMap(item => {
      try {
        const input = messageInput(
          { text: item.text, clientMessageId: item.id, attachments: item.attachments, settings: item.settings },
          record,
          () => item.id,
        )
        const settled = item.status === 'queued' || item.status === 'failed' || item.status === 'uncertain'
        return [
          {
            ...item,
            id: input.clientMessageId,
            text: input.text,
            settings: input.settings,
            status: settled ? item.status : ('uncertain' as const),
            mode: item.mode === 'guidance' ? ('guidance' as const) : ('normal' as const),
            error: settled ? (item.error ?? null) : '上次退出前已开始交付，请核对后再重试',
          },
        ]
      } catch {
        return []
      }
    })
    return { items, paused: items.length > 0, receipts: Array.isArray(raw.receipts) ? raw.receipts.slice(-256) : [] }
  }

  /** 不启动会话，只看已保存的队列有多少条、是否暂停（与 loadQueue 一致：重启后有排队就是暂停） */
  peekQueue(id: string): QueueSummary | null {
    const raw = readJson<QueueFile & { version?: number }>(join(this.sessionDir(id), 'queue.json'))
    if (!raw || raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length === 0) return null
    const failed = raw.items.filter(item => item.status === 'failed' || item.status === 'uncertain').length
    return { queued: raw.items.length - failed, failed, paused: true }
  }

  saveQueue(id: string, queue: QueueFile): void {
    const dir = this.sessionDir(id)
    mkdirSync(dir, { recursive: true })
    writeJson(join(dir, 'queue.json'), { version: 1, ...queue })
  }

  /** 回退：用保留的条目原子重写对话记录（先写临时文件再改名） */
  replaceItems(sessionId: string, items: Item[]): void {
    const dir = this.sessionDir(sessionId)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'items.jsonl'),
      tmp = `${file}.tmp`
    writeFileSync(tmp, items.map(item => JSON.stringify(item) + '\n').join(''), 'utf8')
    replaceFile(tmp, file)
  }

  /** 读出全部条目；同一个 id 出现多次时保留第一次的位置、最后一次的内容 */
  loadItems(sessionId: string): Item[] {
    const file = join(this.sessionDir(sessionId), 'items.jsonl')
    if (!existsSync(file)) return []
    const byId = new Map<string, Item>()
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const item = JSON.parse(line) as Item
        if (item && typeof item.id === 'string') byId.set(item.id, item)
      } catch {
        // 跳过写坏的行（例如写到一半断电）
      }
    }
    // 没等到完成的条目（进程退出、应用关闭，包括后台子智能体的）：标成已中断
    return [...byId.values()].map(item =>
      item.kind !== 'user' && item.kind !== 'notice' && item.kind !== 'turn_stats' && item.status === 'running'
        ? { ...item, status: 'interrupted' }
        : item,
    )
  }

  deleteSession(id: string): void {
    rmSync(this.sessionDir(id), { recursive: true, force: true })
  }
}
