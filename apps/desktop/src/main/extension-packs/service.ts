import { readdirSync, readFileSync, statSync } from 'node:fs'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import type { ExtPackInfo, ExtPackOptions, ExtPackState, SkillCommand } from '@pixelsky/protocol'
import {
  codedError,
  EXT_LIMITS,
  EXT_MANIFEST,
  loaderIssue,
  packStatus,
  parseJsonc,
  resolvePackPath,
} from '@pixelsky/protocol'
import { addPackIssue, hasManifest, loadPack, packKey, type LoadedPack } from './loader'
import { ensureClaudeWrappers, gcClaudeWrappers, packSkillCommands, packSkillLaunch } from './skills'
import { readStateFile, writeStateFile, emptyState, type PackStateFile } from './store'

export interface ExtPacksOptions {
  dataDir: string
  builtinDir: string
  appVersion: string
}

type Engine = 'claude' | 'codex' | 'pixel'

/** 目录名列表（内置扩展目录：<builtinDir>/<扩展 id>/） */
function builtinDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
}

/** 只为估算“启动时要不要等扩展技能”：清单里 contributes.skills 非空，读不了就当没有 */
function declaresSkills(root: string): boolean {
  try {
    const file = join(root, EXT_MANIFEST)
    if (statSync(file).size > EXT_LIMITS.manifestBytes) return false
    const text = readFileSync(file, 'utf8')
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = parseJsonc(text)
    }
    const skills = (raw as { contributes?: { skills?: unknown } } | null)?.contributes?.skills
    return Array.isArray(skills) && skills.length > 0
  } catch {
    return false
  }
}

const TEXT_FILE = /\.(md|txt)$/i
const LICENSE_FILE = /^LICENSE/i

/** 扩展包的主进程服务：加载内置和文件夹扩展、保存开关、把技能并进引擎启动（见 docs 计划 §1） */
export class ExtensionPacks {
  private started = false
  private ready_ = false
  private loading = true
  private revision = 0
  private preKey = ''
  private data: PackStateFile = emptyState()
  private packs: LoadedPack[] = []
  private wrappers = new Map<string, string>()
  private phase1: Promise<void> = Promise.resolve()
  private phase2: Promise<void> = Promise.resolve()
  private chain: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(readonly opts: ExtPacksOptions) {}

  private get stateFile(): string {
    return join(this.opts.dataDir, 'state.json')
  }

  private get runtimeDir(): string {
    return join(this.opts.dataDir, 'runtime')
  }

  /** 幂等：同步预读 + 清理 Claude 包装目录 + 开始异步加载 */
  start(): void {
    if (this.started) return
    this.started = true
    this.data = readStateFile(this.stateFile)
    this.preKey = this.preReadKey()
    gcClaudeWrappers(this.runtimeDir)
    this.phase1 = this.loadBuiltin().catch(e => console.error('[extension-packs] builtin load failed', e))
    this.phase2 = this.phase1
      .then(() => this.loadFolders())
      .catch(e => console.error('[extension-packs] folder load failed', e))
      .then(() => {
        this.loading = false
        this.ready_ = true
        this.commit()
      })
  }

  /** 内置扩展加载完（必要时先 start） */
  builtinReady(): Promise<void> {
    this.start()
    return this.phase1
  }

  /** 所有扩展加载完（必要时先 start） */
  ready(): Promise<void> {
    this.start()
    return this.phase2
  }

  state(): ExtPackState {
    return { revision: this.revision, loading: this.loading, packs: this.packs.map(p => p.info) }
  }

  // ---------- 加载 ----------

  private builtinEnabled(id: string): { enabled: boolean; options: ExtPackOptions } {
    return this.data.builtin[id] ?? { enabled: true, options: {} }
  }

  /** ready 之前的技能 key：状态文件和各清单里一个带技能的都没有就是 ''，否则 'loading'（会话在加载期间启动，下一轮会重新启动一次） */
  private preReadKey(): string {
    for (const name of builtinDirs(this.opts.builtinDir))
      if (this.builtinEnabled(name).enabled && declaresSkills(join(this.opts.builtinDir, name))) return 'loading'
    for (const f of this.data.folders) if (f.enabled && declaresSkills(resolve(f.path))) return 'loading'
    return ''
  }

  private async loadBuiltin(): Promise<void> {
    const packs: LoadedPack[] = []
    for (const name of builtinDirs(this.opts.builtinDir)) {
      const st = this.builtinEnabled(name)
      packs.push(
        await loadPack({
          key: packKey('builtin', name),
          root: join(this.opts.builtinDir, name),
          source: 'builtin',
          enabled: st.enabled,
          addedAt: 0,
          options: st.options,
          revision: 1,
          appVersion: this.opts.appVersion,
        }),
      )
    }
    this.packs = [...packs, ...this.packs.filter(p => p.info.source === 'folder')]
    this.markDuplicates()
    await this.refreshWrappers()
    this.commit()
  }

  private async loadFolders(): Promise<void> {
    const folders: LoadedPack[] = []
    for (const f of this.data.folders) {
      const root = resolve(f.path)
      folders.push(
        await loadPack({
          key: packKey('folder', root),
          root,
          source: 'folder',
          enabled: f.enabled,
          addedAt: f.addedAt,
          options: f.options,
          revision: 1,
          appVersion: this.opts.appVersion,
        }),
      )
    }
    this.packs = [...this.packs.filter(p => p.info.source === 'builtin'), ...folders]
    this.markDuplicates()
    await this.refreshWrappers()
  }

  /** 清单 id 重复：按顺序（内置在前）先到先得，后到的整个扩展报错不加载 */
  private markDuplicates(): void {
    // 先清掉旧的重复标记（删掉先到的那个后，后到的要恢复）
    for (const pack of this.packs) {
      const info = pack.info
      if (!info.issues.some(i => i.code === 'pack.duplicateId')) continue
      info.issues = info.issues.filter(i => i.code !== 'pack.duplicateId')
      info.status = packStatus(info.issues)
      info.live = info.enabled && info.status !== 'error'
    }
    const seen = new Set<string>()
    for (const pack of this.packs) {
      const id = pack.info.id
      if (!id) continue
      if (seen.has(id)) addPackIssue(pack, loaderIssue('pack.duplicateId', { id }))
      else seen.add(id)
    }
  }

  private async refreshWrappers(): Promise<void> {
    this.wrappers = await ensureClaudeWrappers(
      this.runtimeDir,
      this.packs.filter(p => p.info.live),
    )
  }

  private commit(): void {
    this.revision++
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // 监听者出错不影响别的
      }
    }
  }

  private save(): void {
    writeStateFile(this.stateFile, this.data)
  }

  /** 所有变更串行执行，并等加载完再开始 */
  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => this.ready()).then(fn)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private find(key: string): LoadedPack {
    const pack = this.packs.find(p => p.info.key === key)
    if (!pack) throw codedError('extpacks.unknownPack')
    return pack
  }

  private folderEntry(pack: LoadedPack): PackStateFile['folders'][number] | undefined {
    return this.data.folders.find(f => packKey('folder', resolve(f.path)) === pack.info.key)
  }

  /** 把开关 / 选项写回状态文件里这个扩展的那一项 */
  private persist(pack: LoadedPack): void {
    const { enabled, options } = pack.info
    if (pack.info.source === 'builtin') this.data.builtin[basename(pack.root)] = { enabled, options }
    else {
      const entry = this.folderEntry(pack)
      if (entry) {
        entry.enabled = enabled
        entry.options = options
      }
    }
    this.save()
  }

  // ---------- 变更 ----------

  addFolder(path: string): Promise<ExtPackInfo> {
    return this.mutate(async () => {
      const root = resolve(path)
      if (!hasManifest(root)) throw codedError('extpacks.noManifest')
      const key = packKey('folder', root)
      if (this.packs.some(p => p.info.key === key)) throw codedError('extpacks.duplicatePath')
      const addedAt = Date.now()
      const pack = await loadPack({
        key,
        root,
        source: 'folder',
        enabled: true,
        addedAt,
        options: {},
        revision: 1,
        appVersion: this.opts.appVersion,
      })
      const id = pack.info.id
      if (id && this.packs.some(p => p.info.id === id)) throw codedError('extpacks.duplicateId', { id })
      this.data.folders.push({ path: root, enabled: true, addedAt, options: {} })
      this.save()
      this.packs.push(pack)
      await this.refreshWrappers()
      this.commit()
      return pack.info
    })
  }

  setEnabled(key: string, enabled: boolean): Promise<void> {
    return this.mutate(async () => {
      const pack = this.find(key)
      pack.info.enabled = enabled
      pack.info.live = enabled && pack.info.status !== 'error'
      this.persist(pack)
      await this.refreshWrappers()
      this.commit()
    })
  }

  remove(key: string): Promise<void> {
    return this.mutate(async () => {
      const pack = this.find(key)
      if (pack.info.source === 'builtin') throw codedError('extpacks.builtinRemove')
      this.data.folders = this.data.folders.filter(f => packKey('folder', resolve(f.path)) !== key)
      this.save()
      this.packs = this.packs.filter(p => p !== pack)
      this.markDuplicates()
      await this.refreshWrappers()
      this.commit()
    })
  }

  reload(key: string | null): Promise<void> {
    return this.mutate(async () => {
      const targets =
        key === null
          ? [...this.packs]
          : [
              this.find(key),
              ...this.packs.filter(p => p.info.key !== key && p.info.issues.some(i => i.code === 'pack.duplicateId')),
            ]
      for (const old of targets) {
        const fresh = await loadPack({
          key: old.info.key,
          root: old.root,
          source: old.info.source,
          enabled: old.info.enabled,
          addedAt: old.info.addedAt,
          options: old.info.options,
          revision: old.info.revision + 1,
          appVersion: this.opts.appVersion,
        })
        this.packs = this.packs.map(p => (p === old ? fresh : p))
      }
      this.markDuplicates()
      await this.refreshWrappers()
      this.commit()
    })
  }

  setOptions(key: string, patch: ExtPackOptions): Promise<void> {
    return this.mutate(async () => {
      const pack = this.find(key)
      pack.info.options = { ...pack.info.options, ...patch }
      this.persist(pack)
      this.commit()
    })
  }

  // ---------- 读文件 ----------

  /** 路径合法 + 在文件表里（普通文件）+ 没有文件级错误；读取那一刻再核对一次“不是链接、真实路径在扩展目录内” */
  private async locate(key: string, path: string): Promise<{ pack: LoadedPack; rel: string; file: string } | null> {
    await this.ready()
    const pack = this.packs.find(p => p.info.key === key)
    if (!pack) return null
    const rel = resolvePackPath('', path)
    if (!rel || !pack.files.has(rel)) return null
    if (pack.info.issues.some(i => i.severity === 'error' && i.scope === 'file' && i.path === rel)) return null
    const file = join(pack.root, rel)
    try {
      if (!(await lstat(file)).isFile()) return null
      const [r, f] = await Promise.all([realpath(pack.root), realpath(file)])
      if (!f.startsWith(r.endsWith(sep) ? r : r + sep)) return null
    } catch {
      return null
    }
    return { pack, rel, file }
  }

  /** 只读 .json，≤2 MB，限制在扩展目录内，允许注释和结尾逗号 */
  async readJson(key: string, path: string): Promise<unknown> {
    await this.ready()
    this.find(key)
    if (!/\.json$/i.test(path)) throw codedError('extpacks.badPath')
    const hit = await this.locate(key, path)
    if (!hit || (hit.pack.files.get(hit.rel) ?? 0) > EXT_LIMITS.fileBytes) throw codedError('extpacks.badPath')
    try {
      return parseJsonc(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(hit.file)))
    } catch {
      throw codedError('extpacks.badPath')
    }
  }

  /** 只读 .md / .txt / LICENSE*，≤256 KB */
  async readText(key: string, path: string): Promise<string> {
    await this.ready()
    this.find(key)
    const name = path.split('/').pop() ?? ''
    if (!TEXT_FILE.test(name) && !LICENSE_FILE.test(name)) throw codedError('extpacks.badPath')
    const hit = await this.locate(key, path)
    if (!hit || (hit.pack.files.get(hit.rel) ?? 0) > EXT_LIMITS.textBytes) throw codedError('extpacks.badPath')
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(hit.file))
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    } catch {
      throw codedError('extpacks.badPath')
    }
  }

  /** 给资源协议用：svg / png，≤2 MB，扩展要生效（扩展自己的图标例外：停用的扩展在列表里也要显示图标） */
  async assetFile(key: string, path: string): Promise<{ file: string; mime: 'image/svg+xml' | 'image/png' } | null> {
    const mime = /\.svg$/i.test(path) ? 'image/svg+xml' : /\.png$/i.test(path) ? 'image/png' : null
    if (!mime) return null
    const hit = await this.locate(key, path)
    if (!hit) return null
    const { pack, rel } = hit
    if (!pack.info.live && !(pack.info.manifest && pack.info.manifest.icon === rel)) return null
    if ((pack.files.get(rel) ?? 0) > EXT_LIMITS.fileBytes) return null
    return { file: hit.file, mime }
  }

  location(key: string): string {
    return this.find(key).root
  }

  // ---------- 技能 ----------

  /** 同步；ready 之前只给一个 key（'' 或 'loading'），不给目录 */
  skillLaunch(engine: Engine): { key: string; pluginDirs: string[]; skillRoots: string[] } {
    if (engine === 'pixel') return { key: '', pluginDirs: [], skillRoots: [] }
    if (!this.ready_) return { key: this.preKey, pluginDirs: [], skillRoots: [] }
    return packSkillLaunch(
      this.packs.filter(p => p.info.live),
      this.wrappers,
      engine,
    )
  }

  skillCommands(): SkillCommand[] {
    return packSkillCommands(this.packs.filter(p => p.info.live))
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
