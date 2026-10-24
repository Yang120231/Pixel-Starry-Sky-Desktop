// 对话检查点（docs/ui/undo-changes.md）：每轮开始前、结束时给工作目录拍快照；
// 改动卡片按文件撤回 / 恢复，回退时用它还原代码（可以只还原其中几个文件）
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  CheckpointDisabled,
  CheckpointList,
  RevertFilesResult,
  RevertSkip,
  RewindCodePreview,
} from '@pixelsky/protocol'
import { CHECKPOINT_EXPIRED, CheckpointError, ShadowRepo, workPath, type TreeBlob } from '../checkpoints'
import { diffText } from '../diff'
import { describeError, logger } from '../log'
import { UNDO_LIMIT } from './branch'
import type { HostContext } from './context'

const log = logger('engine.checkpoints')

/**
 * 发消息前最多等快照这么久。没拍完这一轮就不等了（这一轮没有快照），git 在后台接着跑完，
 * 索引建好了下一轮就快（第一次要把工作目录算一遍）
 */
const BEFORE_WAIT = 5_000
/** 一条 git 命令的超时（拍快照、预览和还原前） */
const LATER_TIMEOUT = 60_000
/** 连续这么多次拍快照超时，这次运行里停用这个会话的快照（重启后再试） */
const SLOW_LIMIT = 3
/** 影子仓库超过这个大小就删掉并停用 */
export const CHECKPOINT_LIMIT = 200 * 1024 * 1024
/** 冲突确认框里的 diff 最多这么长 */
const CONFLICT_DIFF_LIMIT = 20_000

interface TurnData {
  /** 这一轮开始前 / 结束时的树 */
  before?: string
  after?: string
  /** 这一轮改了哪些文件（before → after） */
  files?: string[]
  at: number
  /** 快照缺了内容（项目的 git 清理了借来的对象、影子仓库被删过）：不能再用 */
  lost?: true
}

interface FileData {
  version: 1
  /** 影子仓库对应的工作目录：会话换了目录就从头来 */
  cwd: string
  disabled?: CheckpointDisabled
  message?: string
  turns: Record<string, TurnData>
}

interface State {
  repo: ShadowRepo
  data: FileData
}

/** 撤回前的文件内容；null 表示当时文件不存在 */
type Saved = { path: string; data: Buffer | null }[]

interface Revert {
  itemId: string
  paths: string[]
  files: Saved
}

const SKIP_TEXT: Record<RevertSkip, string> = {
  outside: '不在工作目录里',
  excluded: '被 .gitignore 或默认规则排除，没有快照',
  'no-checkpoint': '这一轮没有代码快照',
  special: '子模块或链接，不能撤回',
  failed: '读写失败',
}

export class HostCheckpoints {
  private readonly states = new Map<string, State>()
  /** 改动卡片撤回的文件，按会话；只在内存里 */
  private readonly reverts = new Map<string, Map<string, Revert>>()
  /** 没装 git：这次运行里不再试（装上后重启生效） */
  private noGit = false
  /** 每个会话连续超时的次数；到 SLOW_LIMIT 就停用（只在内存里） */
  private readonly timeouts = new Map<string, number>()
  /** 开始打字时预先拍第一次的会话（每次运行只拍一次） */
  private readonly prepared = new Set<string>()

  constructor(private readonly ctx: HostContext) {}

  private state(id: string): State | null {
    const record = this.ctx.records.get(id)
    if (!record?.cwd) return null
    const known = this.states.get(id)
    if (known && known.data.cwd === record.cwd) return known
    let data = parseData(this.ctx.store.loadCheckpoints(id))
    const repo = new ShadowRepo(this.ctx.store.checkpointDir(id), record.cwd)
    if (data && data.cwd !== record.cwd) {
      // 会话换了工作目录：旧快照对不上
      void repo.destroy()
      data = null
    }
    const state = { repo, data: data ?? { version: 1 as const, cwd: record.cwd, turns: {} } }
    this.states.set(id, state)
    return state
  }

  private save(id: string, state: State): void {
    try {
      this.ctx.store.saveCheckpoints(id, state.data)
    } catch (err) {
      log.warn('保存检查点记录失败', { session: id, error: describeError(err) })
    }
  }

  /** 拍快照失败：连续超时几次就停用（这次运行），没装 git 这次运行不再试，其他错误只跳过这一次 */
  private failed(id: string, err: unknown): void {
    const reason = err instanceof CheckpointError ? err.reason : 'failed'
    log.warn('拍快照失败', { session: id, reason, error: describeError(err) })
    if (reason === 'no-git') this.noGit = true
    else if (reason === 'timeout') this.timeouts.set(id, (this.timeouts.get(id) ?? 0) + 1)
  }

  /** 拍快照，成功时清掉连续超时的计数；失败返回 null */
  private capture(id: string, state: State): Promise<string | null> {
    return state.repo.capture(LATER_TIMEOUT).then(
      tree => {
        this.timeouts.delete(id)
        return tree
      },
      (err: unknown) => {
        this.failed(id, err)
        return null
      },
    )
  }

  /** 超过大小上限：删掉影子仓库并停用 */
  private async checkSize(id: string, state: State): Promise<void> {
    try {
      const size = await state.repo.size()
      if (size <= CHECKPOINT_LIMIT) return
      log.info('检查点超过大小上限，停用', { session: id, size })
      await state.repo.destroy()
      state.data = { version: 1, cwd: state.data.cwd, disabled: 'too-large', turns: {} }
      this.save(id, state)
    } catch (err) {
      log.warn('读检查点大小失败', { session: id, error: describeError(err) })
    }
  }

  /** 停用原因：持久的（超过大小）或这次运行里的（没装 git、连续超时） */
  private disabledReason(state: State | null, id: string): CheckpointDisabled | null {
    if (this.noGit) return 'no-git'
    if ((this.timeouts.get(id) ?? 0) >= SLOW_LIMIT) return 'slow'
    return state?.data.disabled ?? null
  }

  /** 能用已有的快照（撤回、回退）：没装 git、超过大小（影子仓库已删）就不能 */
  private usable(id: string): State | null {
    if (!this.ctx.opts.checkpoints || this.noGit) return null
    const state = this.state(id)
    return state && !state.data.disabled ? state : null
  }

  /** 能拍新的快照：还要没在退出、没有连续超时 */
  private capturable(id: string): State | null {
    if (this.ctx.closing || (this.timeouts.get(id) ?? 0) >= SLOW_LIMIT) return null
    return this.usable(id)
  }

  /**
   * 开始在输入框里打字时调用：这个会话还没拍过快照就在后台先拍一次，发消息时就不用从头算整个工作目录。
   * 只建影子仓库和索引，结果不记
   */
  prepare(id: string): void {
    if (this.prepared.has(id)) return
    const state = this.capturable(id)
    if (!state || state.repo.exists()) return
    this.prepared.add(id)
    void this.capture(id, state)
  }

  /** 发消息前拍一次（turn.ts pump）：最多等 BEFORE_WAIT，失败或没拍完都不挡发消息 */
  async beforeTurn(id: string, itemId: string): Promise<void> {
    const state = this.capturable(id)
    if (!state) return
    const started = Date.now()
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<'late'>(resolve => {
      timer = setTimeout(() => resolve('late'), BEFORE_WAIT)
    })
    const tree = await Promise.race([this.capture(id, state), late])
    clearTimeout(timer)
    if (tree === 'late') {
      log.info('快照没拍完，这一轮先不等', { session: id, ms: Date.now() - started })
      return
    }
    if (!tree || this.states.get(id) !== state) return
    state.data.turns[itemId] = { before: tree, at: Date.now() }
    this.save(id, state)
    log.debug('拍快照', { session: id, ms: Date.now() - started })
    void this.checkSize(id, state)
  }

  /** 一轮结束时拍一次，记下这一轮改了哪些文件（events.ts turn_completed）；不等它 */
  afterTurn(id: string, itemId: string): void {
    const state = this.capturable(id)
    const turn = state?.data.turns[itemId]
    if (!state || !turn?.before) return
    const before = turn.before
    void (async () => {
      const after = await this.capture(id, state)
      if (!after) return
      try {
        const files = (await state.repo.diff(before, after)).map(c => c.path)
        // 期间会话换了目录、被停用：不写
        if (this.states.get(id) !== state || state.data.disabled) return
        state.data.turns[itemId] = { ...turn, after, files }
        this.save(id, state)
        void this.checkSize(id, state)
      } catch (err) {
        this.failed(id, err)
      }
    })()
  }

  /** 这条消息有开始前的快照 */
  has(id: string, itemId: string): boolean {
    const turn = this.usable(id)?.data.turns[itemId]
    return !!turn?.before && !turn.lost
  }

  /** 这条消息原来有快照、但已经失效 */
  expired(id: string, itemId: string): boolean {
    return !!this.usable(id)?.data.turns[itemId]?.lost
  }

  /** 用快照前查一遍内容还全不全；缺了就记下失效（以后不再列出、不再用）。查不了（git 出错）时当成完整，交给后面的命令报错 */
  private async intact(id: string, state: State, itemId: string): Promise<boolean> {
    const turn = state.data.turns[itemId]
    if (!turn?.before || turn.lost) return false
    let incomplete = false
    try {
      incomplete = await state.repo.incomplete(turn.before, LATER_TIMEOUT)
    } catch (err) {
      log.warn('检查快照失败', { session: id, error: describeError(err) })
    }
    if (!incomplete) return true
    log.info('快照缺了内容，记为失效', { session: id, item: itemId })
    if (this.states.get(id) === state && state.data.turns[itemId] === turn) {
      state.data.turns[itemId] = { ...turn, lost: true }
      this.save(id, state)
    }
    return false
  }

  list(id: string): CheckpointList {
    const state = this.usable(id)
    const disabled = this.ctx.opts.checkpoints ? this.disabledReason(this.state(id), id) : null
    const items = this.ctx.m.sessions.runtime(id).snapshot.items
    const present = new Set(items.map(item => item.id))
    const turns: CheckpointList['turns'] = []
    // 连续超时停用只是不再拍新的，已有的照样列出、能用
    if (state)
      for (const item of items) {
        const turn = item.kind === 'user' ? state.data.turns[item.id] : undefined
        if (turn?.before && !turn.lost) turns.push({ itemId: item.id, files: turn.files ?? null, at: turn.at })
      }
    const reverted = [...(this.reverts.get(id)?.entries() ?? [])]
      .filter(([, r]) => present.has(r.itemId))
      .map(([revertId, r]) => ({ revertId, itemId: r.itemId, paths: r.paths }))
    return {
      disabled,
      ...(state?.data.message ? { message: state.data.message } : {}),
      turns,
      reverted,
    }
  }

  /**
   * 对话里还在的各轮（按顺序）和它们的快照；回退移除的轮次不算。
   * 失效的轮次也留着：失效的是开始前的快照，结束时的可能还好好的，跳过它会把它改的文件当成手改
   */
  private presentTurns(id: string, state: State): { itemId: string; turn: TurnData }[] {
    return this.ctx.m.sessions
      .runtime(id)
      .snapshot.items.flatMap(item =>
        item.kind === 'user' && state.data.turns[item.id]
          ? [{ itemId: item.id, turn: state.data.turns[item.id]! }]
          : [],
      )
  }

  /** 对话里最后一次拍到的「一轮结束时」：之后的改动算手改 */
  private lastAfter(id: string, state: State): string | null {
    const turns = this.presentTurns(id, state)
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i]!.turn.after) return turns[i]!.turn.after!
    return null
  }

  /** 这一轮结束时的样子：结束时没拍到（应用中途退出）就用下一轮开始前的 */
  private endOf(id: string, state: State, itemId: string): string | null {
    const turns = this.presentTurns(id, state)
    const i = turns.findIndex(t => t.itemId === itemId)
    if (i < 0) return null
    return turns[i]!.turn.after ?? turns[i + 1]?.turn.before ?? null
  }

  /** 回退到这条消息之前要还原哪些文件（branch.ts 有快照时用它） */
  async preview(id: string, itemId: string): Promise<RewindCodePreview> {
    const state = this.usable(id)
    const before = state?.data.turns[itemId]?.before
    if (!state || !before) return { ok: false, reason: 'no-checkpoint' }
    try {
      if (!(await this.intact(id, state, itemId))) return { ok: false, reason: 'expired', message: CHECKPOINT_EXPIRED }
      const current = await state.repo.capture(LATER_TIMEOUT)
      const changes = await state.repo.diff(before, current)
      const last = this.lastAfter(id, state)
      const names = new Set(changes.map(c => c.path))
      // 最后一轮结束时的快照也可能缺了内容：查不出手改，不挡回退
      const edited = last
        ? await state.repo.diff(last, current).then(
            list => list.map(c => c.path).filter(p => names.has(p)),
            () => [],
          )
        : []
      let size = 0
      for (const c of changes) size += fileSize(join(state.data.cwd, c.path))
      return {
        ok: true,
        files: changes.map(c => c.path),
        insertions: changes.reduce((n, c) => n + c.insertions, 0),
        deletions: changes.reduce((n, c) => n + c.deletions, 0),
        undoable: size <= UNDO_LIMIT,
        edited,
        checkpoint: true,
      }
    } catch (err) {
      return { ok: false, reason: 'failed', message: describeError(err) }
    }
  }

  /**
   * 把文件还原到这条消息之前（branch.ts 回退）；paths 只还原这些（相对工作目录）。
   * 返回还原前的内容（撤销用），总共超过 UNDO_LIMIT 时为 null；快照失效时整个返回 null（没动文件，可以改用引擎自己的检查点）
   */
  async restore(id: string, itemId: string, paths?: string[]): Promise<{ saved: Saved | null; count: number } | null> {
    const state = this.usable(id)
    const before = state?.data.turns[itemId]?.before
    if (!state || !before) throw new Error('这条消息没有代码快照，代码保持不变')
    if (!(await this.intact(id, state, itemId))) return null
    const current = await state.repo.capture(LATER_TIMEOUT)
    const only = paths ? new Set(paths) : null
    const changes = (await state.repo.diff(before, current)).filter(c => !only || only.has(c.path))
    const saved: Saved = []
    let size = 0
    for (const c of changes) {
      const blob = await state.repo.blob(before, c.path)
      if (blob === 'special') continue
      const file = join(state.data.cwd, c.path)
      const data = readOrNull(file)
      size += data?.length ?? 0
      saved.push({ path: file, data })
      writeBlob(file, blob)
    }
    return { saved: size <= UNDO_LIMIT ? saved : null, count: saved.length }
  }

  /**
   * 改动卡片撤回文件：改回这一轮开始前的内容（这一轮新建的删掉）。这一轮结束之后文件又被改过、force 不为真时，
   * 只返回会丢掉的内容，不改文件
   */
  async revertFiles(id: string, itemId: string, paths: string[], force: boolean): Promise<RevertFilesResult> {
    return this.holding(id, () => this.doRevert(id, itemId, paths, force))
  }

  private async doRevert(id: string, itemId: string, paths: string[], force: boolean): Promise<RevertFilesResult> {
    const state = this.usable(id)
    const turn = state?.data.turns[itemId]
    const skipped: Extract<RevertFilesResult, { kind: 'done' }>['skipped'] = []
    const skip = (path: string, reason: RevertSkip): void => {
      skipped.push({ path, reason, message: SKIP_TEXT[reason] })
    }
    if (!state || !turn?.before) {
      for (const path of paths) skip(path, 'no-checkpoint')
      return { kind: 'done', revertId: null, reverted: [], skipped }
    }
    if (!(await this.intact(id, state, itemId))) {
      for (const path of paths) skipped.push({ path, reason: 'no-checkpoint', message: CHECKPOINT_EXPIRED })
      return { kind: 'done', revertId: null, reverted: [], skipped }
    }
    const before = turn.before
    const targets: { input: string; rel: string; file: string; blob: TreeBlob }[] = []
    const inside = paths.flatMap(input => {
      const rel = workPath(state.data.cwd, input)
      if (!rel) skip(input, 'outside')
      return rel ? [{ input, rel }] : []
    })
    const ignored = await state.repo.ignored(inside.map(p => p.rel))
    for (const { input, rel } of inside) {
      const blob = await state.repo.blob(before, rel)
      // 快照里没有、又被排除的文件：不知道它原来是什么样（不能当成新建的删掉）
      if (blob === null && ignored.has(rel)) skip(input, 'excluded')
      else if (blob === 'special') skip(input, 'special')
      else targets.push({ input, rel, file: join(state.data.cwd, rel), blob })
    }
    const end = force ? null : this.endOf(id, state, itemId)
    if (end) {
      const conflicts: Extract<RevertFilesResult, { kind: 'conflict' }>['conflicts'] = []
      for (const t of targets) {
        // 结束时的快照缺了内容：比不了，当作没手改过（和结束时没拍到一样）
        const then = await state.repo.blob(end, t.rel).catch(() => 'special' as const)
        if (then === 'special') continue
        const now = readOrNull(t.file)
        if (sameContent(then, now)) continue
        conflicts.push({ path: t.input, ...conflictDiff(then, now) })
      }
      if (conflicts.length) return { kind: 'conflict', conflicts }
    }
    const saved: Saved = []
    const reverted: string[] = []
    for (const t of targets) {
      try {
        const data = readOrNull(t.file)
        writeBlob(t.file, t.blob as Buffer | null)
        saved.push({ path: t.file, data })
        reverted.push(t.input)
      } catch (err) {
        skipped.push({ path: t.input, reason: 'failed', message: describeError(err) })
      }
    }
    if (!reverted.length) return { kind: 'done', revertId: null, reverted, skipped }
    const revertId = randomUUID()
    let map = this.reverts.get(id)
    if (!map) this.reverts.set(id, (map = new Map()))
    map.set(revertId, { itemId, paths: reverted, files: saved })
    return { kind: 'done', revertId, reverted, skipped }
  }

  /** 恢复撤回的文件：写回撤回前一刻的内容；paths 只恢复其中这些（撤回时传的路径） */
  async restoreFiles(id: string, revertId: string, paths?: string[]): Promise<void> {
    return this.holding(id, async () => this.doRestore(id, revertId, paths))
  }

  private doRestore(id: string, revertId: string, paths?: string[]): void {
    const entry = this.reverts.get(id)?.get(revertId)
    if (!entry) throw new Error('撤回记录已经没有了（重启过应用）')
    const only = paths ? new Set(paths) : null
    const keepPaths: string[] = []
    const keepFiles: Saved = []
    entry.paths.forEach((path, i) => {
      const file = entry.files[i]!
      if (only && !only.has(path)) {
        keepPaths.push(path)
        keepFiles.push(file)
      } else writeBlob(file.path, file.data)
    })
    if (keepPaths.length) this.reverts.get(id)!.set(revertId, { ...entry, paths: keepPaths, files: keepFiles })
    else this.reverts.get(id)!.delete(revertId)
  }

  /** 空闲时才能改文件；改的期间占住会话（changingSessions），不派发新消息 */
  private async holding<T>(id: string, task: () => Promise<T>): Promise<T> {
    const { ctx } = this
    if (ctx.closing) throw new Error('应用正在退出')
    if (ctx.changingSessions.has(id)) throw new Error('正在处理这个会话，请稍后重试')
    const rt = ctx.m.sessions.runtime(id)
    if (rt.snapshot.state !== 'idle' || rt.pumping || rt.stopping || rt.activeId)
      throw new Error('请先停止当前任务再撤回')
    ctx.changingSessions.add(id)
    try {
      return await task()
    } finally {
      ctx.changingSessions.delete(id)
      // 占住期间排队的消息接着发
      queueMicrotask(() => void ctx.m.turn.pump(id))
    }
  }

  /** 应用退出：结束各会话正在跑的 git */
  async shutdown(): Promise<void> {
    await Promise.all([...this.states.values()].map(state => state.repo.stop()))
  }

  /** 会话删掉了：结束后台的 git 再删目录（影子仓库跟着会话目录删） */
  async forget(id: string): Promise<void> {
    const state = this.states.get(id)
    this.states.delete(id)
    this.reverts.delete(id)
    this.timeouts.delete(id)
    this.prepared.delete(id)
    // 不等它拍完：结束正在跑的 git，排着的不再跑
    await state?.repo.stop()
  }
}

function parseData(raw: unknown): FileData | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<FileData>
  if (o.version !== 1 || typeof o.cwd !== 'string' || !o.turns || typeof o.turns !== 'object') return null
  // 「太慢」以前会存下来、永久停用；现在只在这次运行里算，旧记录里的不认
  if (o.disabled === 'slow') delete o.disabled
  return o as FileData
}

function fileSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

function readOrNull(file: string): Buffer | null {
  return existsSync(file) ? readFileSync(file) : null
}

function writeBlob(file: string, data: Buffer | null): void {
  if (data === null) rmSync(file, { force: true })
  else {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data)
  }
}

function sameContent(a: Buffer | null, b: Buffer | null): boolean {
  return a === null || b === null ? a === b : a.equals(b)
}

const isBinary = (b: Buffer | null): boolean => !!b && b.subarray(0, 8000).includes(0)

/** 冲突确认框里的 diff：这一轮结束时 → 现在 */
function conflictDiff(then: Buffer | null, now: Buffer | null): { diff: string; added: number; removed: number } {
  if (isBinary(then) || isBinary(now)) return { diff: '', added: 0, removed: 0 }
  const d = diffText(then?.toString('utf8') ?? '', now?.toString('utf8') ?? '')
  // 只留改动的行和前后各 2 行上下文
  const lines = d.diff.split('\n')
  const keep = new Set<number>()
  lines.forEach((line, i) => {
    if (line[0] === '+' || line[0] === '-') for (let j = i - 2; j <= i + 2; j++) keep.add(j)
  })
  const out: string[] = []
  let last = -2
  lines.forEach((line, i) => {
    if (!keep.has(i)) return
    if (i !== last + 1 && out.length) out.push('…')
    out.push(line)
    last = i
  })
  const diff = out.join('\n')
  return {
    diff: diff.length > CONFLICT_DIFF_LIMIT ? diff.slice(0, CONFLICT_DIFF_LIMIT) + '\n…' : diff,
    added: d.added,
    removed: d.removed,
  }
}
