// 对话检查点的影子 Git 仓库（docs/ui/undo-changes.md §2）：工作树指向会话的工作目录，只存树对象，不碰项目自己的 .git
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { killTree } from './exec'

/** 默认排除的目录：依赖和构建缓存，体积大、AI 一般不改；项目自己的 .gitignore 照常生效 */
export const DEFAULT_EXCLUDES = [
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.gradle/',
  'target/',
  '.next/',
  '.nuxt/',
  '.turbo/',
  '.cache/',
  '.pnpm-store/',
]

/** 树里的一个文件：内容；不在树里是 null；子模块、符号链接等不能当普通文件写回的是 'special' */
export type TreeBlob = Buffer | null | 'special'

export interface TreeChange {
  /** 相对工作目录、用 / 分隔 */
  path: string
  status: 'added' | 'modified' | 'deleted'
  /** 二进制文件为 0 */
  insertions: number
  deletions: number
}

interface GitRun {
  code: number | null
  stdout: Buffer
  stderr: string
  timedOut: boolean
  missing: boolean
}

export class CheckpointError extends Error {
  constructor(
    readonly reason: 'no-git' | 'timeout' | 'failed',
    message: string,
  ) {
    super(message)
  }
}

/** 一条 git 命令；GIT_DIR 等环境变量去掉，免得被外面的设置带到别的仓库 */
function runGit(
  args: string[],
  opts: { cwd?: string; timeout: number; input?: string; running?: Set<ChildProcess> },
): Promise<GitRun> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES)$/i.test(key))
      delete env[key]
  return new Promise(done => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    opts.running?.add(child)
    const out: Buffer[] = []
    let stderr = ''
    let settled = false
    const finish = (run: GitRun): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.running?.delete(child)
      done(run)
    }
    const timer = setTimeout(() => {
      killTree(child)
      finish({ code: null, stdout: Buffer.alloc(0), stderr, timedOut: true, missing: false })
    }, opts.timeout)
    child.stdout!.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_000) stderr += chunk.toString('utf8')
    })
    child.on('error', error =>
      finish({
        code: null,
        stdout: Buffer.alloc(0),
        stderr: error.message,
        timedOut: false,
        missing: (error as NodeJS.ErrnoException).code === 'ENOENT',
      }),
    )
    child.on('close', code => finish({ code, stdout: Buffer.concat(out), stderr, timedOut: false, missing: false }))
    if (opts.input !== undefined) {
      child.stdin!.on('error', () => {})
      child.stdin!.end(opts.input, 'utf8')
    }
  })
}

/** 文件相对工作目录的路径（/ 分隔）；在工作目录外返回 null */
export function workPath(workTree: string, file: string): string | null {
  const rel = relative(workTree, isAbsolute(file) ? file : resolve(workTree, file))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.replaceAll('\\', '/')
}

export class ShadowRepo {
  /** 所有命令排队执行：共用一个索引文件 */
  private chain: Promise<unknown> = Promise.resolve()
  private ready = false
  /** 正在跑的 git（退出时结束它们） */
  private readonly running = new Set<ChildProcess>()
  private stopped = false

  constructor(
    readonly gitDir: string,
    readonly workTree: string,
    private readonly timeout = 30_000,
  ) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const guarded = (): Promise<T> =>
      this.stopped ? Promise.reject(new CheckpointError('failed', '应用正在退出')) : task()
    const next = this.chain.then(guarded, guarded)
    this.chain = next.catch(() => undefined)
    return next
  }

  private git(args: string[], timeout = this.timeout, input?: string): Promise<GitRun> {
    // 停了以后一个操作里剩下的命令（add 之后的 write-tree 等）也不再起
    if (this.stopped)
      return Promise.resolve({
        code: null,
        stdout: Buffer.alloc(0),
        stderr: '应用正在退出',
        timedOut: false,
        missing: false,
      })
    return runGit(
      [
        '-c',
        'core.quotepath=false',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.safecrlf=false',
        '-c',
        'core.longpaths=true',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'safe.directory=*',
        `--git-dir=${this.gitDir}`,
        `--work-tree=${this.workTree}`,
        ...args,
      ],
      { cwd: this.workTree, timeout, input, running: this.running },
    )
  }

  private async must(args: string[], timeout = this.timeout, input?: string): Promise<Buffer> {
    const run = await this.git(args, timeout, input)
    if (run.missing) throw new CheckpointError('no-git', '没有找到 git')
    if (run.timedOut) throw new CheckpointError('timeout', `git ${args[0]} 超时`)
    if (run.code !== 0) throw new CheckpointError('failed', run.stderr.trim() || `git ${args[0]} 失败`)
    return run.stdout
  }

  /** 第一次用时建仓库：借项目的对象库、用项目的索引起步（没改过的文件不用重新算） */
  private async init(): Promise<void> {
    if (this.ready) return
    if (!existsSync(this.workTree) || !statSync(this.workTree).isDirectory())
      throw new CheckpointError('failed', '工作目录不存在')
    if (!existsSync(join(this.gitDir, 'HEAD'))) {
      mkdirSync(this.gitDir, { recursive: true })
      const run = await runGit(['init', '--bare', '--quiet', this.gitDir], { timeout: this.timeout })
      if (run.missing) throw new CheckpointError('no-git', '没有找到 git')
      if (run.code !== 0) throw new CheckpointError('failed', run.stderr.trim() || 'git init 失败')
      writeFileSync(
        join(this.gitDir, 'config'),
        '[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfilemode = false\n[gc]\n\tauto = 0\n',
      )
      mkdirSync(join(this.gitDir, 'info'), { recursive: true })
      // 影子仓库自己在工作目录里时（数据目录放在项目里）也排除，不然会把自己拍进去
      const self = workPath(this.workTree, this.gitDir)
      writeFileSync(
        join(this.gitDir, 'info', 'exclude'),
        [...DEFAULT_EXCLUDES, ...(self ? [`/${self}/`] : [])].join('\n') + '\n',
      )
      await this.borrowObjects()
    }
    // 存原样字节：项目 .gitattributes 的换行转换（text=auto、eol）、过滤器（LFS）、编码转换都不要，
    // 否则写回去的是转换过的内容。info/attributes 优先于工作树里的 .gitattributes
    writeFileSync(join(this.gitDir, 'info', 'attributes'), '* -text -filter -ident -working-tree-encoding\n')
    this.ready = true
  }

  /**
   * 工作目录在 Git 仓库里：借它的对象库，内容一样的文件不再存一份。
   * 不复制项目的索引当起点：那里记的是按项目设置转换过的内容（autocrlf、LFS 指针），文件没改时不会重新算
   */
  private async borrowObjects(): Promise<void> {
    const run = await runGit(['-c', 'safe.directory=*', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: this.workTree,
      timeout: 10_000,
    })
    if (run.code !== 0) return
    const common = run.stdout.toString('utf8').split(/\r?\n/)[0]
    if (!common) return
    const objects = join(common, 'objects')
    if (!existsSync(objects)) return
    mkdirSync(join(this.gitDir, 'objects', 'info'), { recursive: true })
    writeFileSync(join(this.gitDir, 'objects', 'info', 'alternates'), objects.replaceAll('\\', '/') + '\n')
  }

  /** 去掉索引锁：命令都在这里排队执行，开始前还在的锁是之前超时被结束的 git 留下的 */
  private dropLock(): void {
    try {
      rmSync(join(this.gitDir, 'index.lock'), { force: true })
    } catch {
      // 删不掉时下面的 git 会报错
    }
  }

  /** 拍一次快照：返回树对象 id。读不了的文件（被占用等）跳过 */
  capture(timeout = this.timeout): Promise<string> {
    return this.serial(async () => {
      await this.init()
      this.dropLock()
      let run = await this.git(['add', '--all', '--ignore-errors', '--', '.'], timeout)
      if (run.missing) throw new CheckpointError('no-git', '没有找到 git')
      // 超时结束的 git 会留下索引锁，下次就拍不了了
      if (run.timedOut) {
        this.dropLock()
        throw new CheckpointError('timeout', '拍快照超时')
      }
      // 索引坏了：删掉从头来
      if (run.code !== 0 && /index file|bad signature|corrupt/i.test(run.stderr)) {
        rmSync(join(this.gitDir, 'index'), { force: true })
        run = await this.git(['add', '--all', '--ignore-errors', '--', '.'], timeout)
        if (run.timedOut) {
          this.dropLock()
          throw new CheckpointError('timeout', '拍快照超时')
        }
      }
      // 退出码 1 是个别文件读不了（被占用等，--ignore-errors 跳过了）；其他非 0 是整个命令失败，
      // 这时索引还是上一次的，接着 write-tree 会把旧状态当成现在
      if (run.code !== 0 && run.code !== 1)
        throw new CheckpointError('failed', run.stderr.trim() || `git add 失败（${run.code}）`)
      return (await this.must(['write-tree'], timeout)).toString('utf8').trim()
    })
  }

  /** 两棵树之间改了哪些文件 */
  diff(from: string, to: string): Promise<TreeChange[]> {
    return this.serial(async () => {
      await this.init()
      const [status, numstat] = await Promise.all([
        this.must(['diff-tree', '-r', '--no-renames', '--name-status', '-z', from, to]),
        this.must(['diff-tree', '-r', '--no-renames', '--numstat', '-z', from, to]),
      ])
      const counts = new Map<string, [number, number]>()
      for (const entry of numstat.toString('utf8').split('\0')) {
        const m = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(entry)
        if (m) counts.set(m[3], [m[1] === '-' ? 0 : Number(m[1]), m[2] === '-' ? 0 : Number(m[2])])
      }
      const parts = status.toString('utf8').split('\0')
      const out: TreeChange[] = []
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const code = parts[i]
        const path = parts[i + 1]
        if (!code || !path) continue
        const [insertions, deletions] = counts.get(path) ?? [0, 0]
        out.push({
          path,
          status: code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified',
          insertions,
          deletions,
        })
      }
      return out
    })
  }

  /** 树里某个文件的内容 */
  blob(tree: string, path: string): Promise<TreeBlob> {
    return this.serial(async () => {
      await this.init()
      const entry = (await this.must(['ls-tree', '-z', tree, '--', path])).toString('utf8').split('\0')[0]
      if (!entry) return null
      const [mode] = entry.split(' ')
      if (mode !== '100644' && mode !== '100755') return 'special'
      return this.must(['cat-file', 'blob', `${tree}:${path}`])
    })
  }

  /** 这些路径里被 .gitignore / 默认排除的（不在快照里） */
  ignored(paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return Promise.resolve(new Set())
    return this.serial(async () => {
      await this.init()
      const run = await this.git(['check-ignore', '--no-index', '-z', '--stdin'], this.timeout, paths.join('\0') + '\0')
      // 退出码 1：都没被排除
      if (run.code !== 0 && run.code !== 1)
        throw new CheckpointError('failed', run.stderr.trim() || 'check-ignore 失败')
      return new Set(run.stdout.toString('utf8').split('\0').filter(Boolean))
    })
  }

  /** 对象库大小（字节） */
  size(): Promise<number> {
    return this.serial(async () => {
      await this.init()
      const text = (await this.must(['count-objects', '-v'])).toString('utf8')
      const kib = (key: string): number => Number(new RegExp(`^${key}: (\\d+)`, 'm').exec(text)?.[1] ?? 0)
      return (kib('size') + kib('size-pack')) * 1024
    })
  }

  /** 应用退出：结束正在跑的 git，排着的不再跑（留下的索引锁下次开始前会清掉） */
  async stop(): Promise<void> {
    this.stopped = true
    for (const child of this.running) killTree(child)
    await this.idle()
  }

  /** 排着的命令都跑完（删会话前等它们，免得 Windows 上目录被占用删不掉） */
  idle(): Promise<void> {
    return this.chain.then(() => undefined)
  }

  /** 影子仓库建好了（拍过快照） */
  exists(): boolean {
    return existsSync(join(this.gitDir, 'HEAD'))
  }

  /** 删掉整个影子仓库 */
  async destroy(): Promise<void> {
    await this.serial(async () => {
      rmSync(this.gitDir, { recursive: true, force: true })
      this.ready = false
    })
  }
}
