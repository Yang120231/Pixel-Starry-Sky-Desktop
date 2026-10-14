import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, readdir, realpath, stat, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, extname } from 'node:path'
import { codedError, parseCodedError } from '@pixelsky/protocol'
import { grepWorkspace } from './workspace-grep'
import type {
  DirectoryListing,
  FileDocument,
  GrepResult,
  WorkspaceRef,
  WorkspaceTarget,
} from '../../shared/types/workspace'

export const TEXT_LIMIT = 2 * 1024 * 1024
export const READ_LIMIT = 10 * 1024 * 1024
const IMAGE_LIMIT = 8 * 1024 * 1024
const PAGE_LIMIT = 500
const SEARCH_LIMIT = 200
const HASH = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const IMAGES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}
export type TargetResolver = (ref: WorkspaceRef) => WorkspaceTarget

export function workspaceRef(value: unknown): WorkspaceRef {
  const v = value as Partial<WorkspaceRef> | null
  if (!v || typeof v !== 'object') throw new Error('缺少项目或会话')
  if (typeof v.sessionId === 'string' && v.sessionId && v.projectId === undefined) return { sessionId: v.sessionId }
  if (typeof v.projectId === 'string' && v.projectId && v.sessionId === undefined) return { projectId: v.projectId }
  throw new Error('项目目标不正确')
}

function inside(root: string, file: string): boolean {
  const r = relative(root, file)
  return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep)
}

/** 相对路径和真实路径都必须位于所选项目，避免目录链接指向项目外。 */
export async function workspacePath(rootPath: string, input: unknown, kind?: 'file' | 'directory'): Promise<string> {
  if (typeof input !== 'string' || input.includes('\0') || input.includes(':') || isAbsolute(input))
    throw codedError('files.relativePath')
  let root: string
  try {
    root = await realpath(rootPath)
  } catch {
    throw new Error('项目目录不存在')
  }
  const candidate = resolve(root, input)
  if (!inside(root, candidate)) throw codedError('files.outsideProject')
  let result: string
  try {
    result = await realpath(candidate)
  } catch {
    throw input ? codedError('files.notFound') : new Error('项目目录不存在')
  }
  if (!inside(root, result)) throw new Error('此链接指向项目外，无法在软件内打开')
  const info = await stat(result)
  if (kind === 'directory' && !info.isDirectory()) throw new Error('目标不是文件夹')
  if (kind === 'file' && !info.isFile()) throw new Error('目标不是普通文件')
  return result
}

/** 文件 / 文件夹名：不能为空、. / ..，不能带 Windows 不允许的字符，也不能以空格或点结尾 */
const BAD_NAME = /[\\/:*?"<>|\0]/
export function validName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !BAD_NAME.test(name) && !/[ .]$/.test(name) && name.length <= 255
}

function relativeInput(input: unknown): string {
  if (typeof input !== 'string' || input.includes('\0') || input.includes(':') || isAbsolute(input))
    throw codedError('files.relativePath')
  return input.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * 项目内一个已存在的条目本身（不跟随最后一级的符号链接，重命名 / 删除的是链接而不是它指向的文件）。
 * 上级目录的真实路径必须在项目内；不能是项目根目录。
 */
export async function workspaceEntry(rootPath: string, input: unknown): Promise<{ root: string; path: string }> {
  const rel = relativeInput(input)
  if (!rel) throw codedError('files.projectRoot')
  const root = await realpath(rootPath).catch(() => {
    throw new Error('项目目录不存在')
  })
  const lexical = resolve(root, rel)
  if (!inside(root, lexical) || lexical === root) throw codedError('files.outsideProject')
  const parent = await realpath(dirname(lexical)).catch(() => {
    throw codedError('files.notFound')
  })
  if (parent !== root && !inside(root, parent)) throw codedError('files.outsideProject')
  const path = join(parent, basename(lexical))
  await lstat(path).catch(() => {
    throw codedError('files.notFound')
  })
  return { root, path }
}

/** 项目内一个还不存在的新路径：名称合法、上级文件夹存在且在项目内、没有同名条目 */
export async function workspaceNewPath(
  rootPath: string,
  input: unknown,
  allowExisting?: string,
): Promise<{ root: string; path: string }> {
  const rel = relativeInput(input)
  const name = rel.split('/').pop() ?? ''
  if (!rel || !validName(name)) throw codedError('files.invalidName')
  const root = await realpath(rootPath).catch(() => {
    throw new Error('项目目录不存在')
  })
  const lexical = resolve(root, rel)
  if (!inside(root, lexical) || lexical === root) throw codedError('files.outsideProject')
  let parent: string
  try {
    parent = await realpath(dirname(lexical))
    if (!(await stat(parent)).isDirectory()) throw new Error()
  } catch {
    throw codedError('files.parentMissing')
  }
  if (parent !== root && !inside(root, parent)) throw codedError('files.outsideProject')
  const path = join(parent, name)
  const existing = await lstat(path).catch(() => null)
  // Windows 上只改大小写（a.ts → A.ts）时新旧是同一个条目，允许
  const sameEntry = allowExisting !== undefined && allowExisting.toLowerCase() === path.toLowerCase()
  if (existing && !sameEntry) throw codedError('files.exists', { name })
  return { root, path }
}

const relativeTo = (root: string, path: string): string => relative(root, path).split(sep).join('/')

async function boundedRead(file: string, max: number): Promise<Buffer> {
  const h = await open(file, 'r')
  try {
    if (!(await h.stat()).isFile()) throw new Error('目标不是普通文件')
    const buffer = Buffer.alloc(max + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await h.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > max) throw new Error('文件太大，请用外部编辑器打开')
    return buffer.subarray(0, offset)
  } finally {
    await h.close()
  }
}

function decode(path: string, bytes: Buffer): Extract<FileDocument, { kind: 'text' }> {
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  const body = bom ? bytes.subarray(3) : bytes
  if (body.includes(0)) throw new Error('二进制文件或非 UTF-8 编码，请用外部编辑器打开')
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new Error('暂不支持此文件编码，请用外部编辑器打开')
  }
  return {
    kind: 'text',
    path,
    content,
    version: HASH(bytes),
    bytes: bytes.length,
    bom,
    newline: content.includes('\r\n') ? 'crlf' : 'lf',
  }
}

export interface WorkspaceFilesOptions {
  /** 删除时移到回收站：本机是系统回收站，远端是数据目录里的回收目录；不提供时拒绝删除 */
  trash?: (absolute: string, relative: string) => Promise<void>
}

export class WorkspaceFiles {
  private saves = new Map<string, Promise<unknown>>()
  constructor(
    private resolveTarget: TargetResolver,
    private options: WorkspaceFilesOptions = {},
  ) {}
  target(value: unknown): WorkspaceTarget {
    return this.resolveTarget(workspaceRef(value))
  }

  /** 新建空文件或文件夹（docs/ui/files-search-terminal-pins.md §3）；返回相对项目的路径 */
  async create(ref: WorkspaceRef, path: unknown, kind: unknown): Promise<{ path: string }> {
    if (kind !== 'file' && kind !== 'folder') throw new Error('参数不正确')
    const target = await workspaceNewPath(this.target(ref).path, path)
    try {
      if (kind === 'folder') await mkdir(target.path)
      else await (await open(target.path, 'wx')).close()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST')
        throw codedError('files.exists', { name: basename(target.path) })
      throw err
    }
    return { path: relativeTo(target.root, target.path) }
  }

  /** 在同一项目内重命名或移动；目标已存在时拒绝 */
  async rename(ref: WorkspaceRef, from: unknown, to: unknown): Promise<{ path: string }> {
    const root = this.target(ref).path
    const source = await workspaceEntry(root, from)
    const target = await workspaceNewPath(root, to, source.path)
    if (target.path === source.path) return { path: relativeTo(source.root, source.path) }
    // 不能把文件夹移进它自己里面（只改大小写时 Windows 的路径比较会把两者当成同一个，跳过这个检查）
    const caseOnly = target.path.toLowerCase() === source.path.toLowerCase()
    if (!caseOnly && inside(source.path, target.path)) throw codedError('files.outsideProject')
    try {
      await rename(source.path, target.path)
    } catch (err) {
      // Windows 上文件被别的程序占着会报 EBUSY / EPERM；目标在另一个盘上报 EXDEV
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM') throw codedError('files.busy', { name: basename(source.path) })
      if (code === 'EXDEV') throw codedError('files.crossDevice')
      throw err
    }
    return { path: relativeTo(target.root, target.path) }
  }

  /** 删除：移到回收站，不做永久删除 */
  async remove(ref: WorkspaceRef, path: unknown): Promise<void> {
    if (!this.options.trash) throw new Error('当前环境不能删除文件')
    const entry = await workspaceEntry(this.target(ref).path, path)
    try {
      await this.options.trash(entry.path, relativeTo(entry.root, entry.path))
    } catch (err) {
      throw codedError('files.trashFailed', { reason: (err as Error).message })
    }
  }

  async list(ref: WorkspaceRef, path: string): Promise<DirectoryListing> {
    const dir = await workspacePath(this.target(ref).path, path, 'directory')
    const all = (await readdir(dir, { withFileTypes: true })).filter(e => e.name !== '.git')
    all.sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
    )
    const entries = await Promise.all(
      all.slice(0, PAGE_LIMIT).map(async e => {
        const next = (path ? path.replaceAll('\\', '/') + '/' : '') + e.name
        let kind: 'directory' | 'file' = e.isDirectory() ? 'directory' : 'file'
        if (e.isSymbolicLink()) {
          try {
            if ((await stat(join(dir, e.name))).isDirectory()) kind = 'directory'
          } catch {
            /* 展示失效链接，打开时说明 */
          }
        }
        return { name: e.name, path: next, kind, linked: e.isSymbolicLink() }
      }),
    )
    return { entries, truncated: all.length > PAGE_LIMIT }
  }

  /**
   * 同 list，但目录不存在时返回 null、不报错：对话和终端里的路径链接、输入框的 @ 菜单只是问一下有没有，
   * 不存在是常事。报错的话 Electron 会把每一次都当错误打到控制台、进日志（ERROR console … files.notFound）
   */
  async listExisting(ref: WorkspaceRef, path: string): Promise<DirectoryListing | null> {
    try {
      return await this.list(ref, path)
    } catch (err) {
      if (parseCodedError(err instanceof Error ? err.message : null)?.code === 'files.notFound') return null
      throw err
    }
  }

  async search(ref: WorkspaceRef, name: string): Promise<DirectoryListing> {
    if (typeof name !== 'string' || name.length > 160) throw new Error('筛选名称过长')
    const term = name.trim().toLocaleLowerCase()
    if (!term) return this.list(ref, '')
    const root = await workspacePath(this.target(ref).path, '', 'directory')
    const entries: DirectoryListing['entries'] = []
    const queue = ['']
    let examined = 0
    const deadline = Date.now() + 2500
    while (queue.length && examined < 10000 && entries.length < SEARCH_LIMIT && Date.now() < deadline) {
      const path = queue.shift()!
      let children
      try {
        children = await readdir(join(root, path), { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of children) {
        if (e.name === '.git' || e.name === 'node_modules') continue
        if (++examined > 10000 || entries.length >= SEARCH_LIMIT) break
        const next = path ? `${path}/${e.name}` : e.name
        if (e.name.toLocaleLowerCase().includes(term))
          entries.push({
            name: e.name,
            path: next,
            kind: e.isDirectory() ? 'directory' : 'file',
            linked: e.isSymbolicLink(),
          })
        if (e.isDirectory() && !e.isSymbolicLink()) queue.push(next)
      }
    }
    return { entries, truncated: queue.length > 0 || examined >= 10000 || entries.length >= SEARCH_LIMIT }
  }

  /** 内容搜索（git grep 或逐个读文件），路径相对项目 */
  async grep(ref: WorkspaceRef, query: unknown): Promise<GrepResult> {
    return grepWorkspace(await workspacePath(this.target(ref).path, '', 'directory'), query)
  }

  async read(ref: WorkspaceRef, path: string): Promise<FileDocument> {
    const file = await workspacePath(this.target(ref).path, path, 'file')
    const info = await stat(file)
    const image = IMAGES[extname(file).toLowerCase()]
    try {
      const bytes = await boundedRead(file, image ? IMAGE_LIMIT : READ_LIMIT)
      if (image)
        return { kind: 'image', path, dataUrl: `data:${image};base64,${bytes.toString('base64')}`, bytes: bytes.length }
      return { ...decode(path, bytes), readonly: bytes.length > TEXT_LIMIT }
    } catch (e) {
      return { kind: 'unsupported', path, reason: (e as Error).message, bytes: info.size }
    }
  }

  /** HEAD 路径使用仓库前缀，避免子目录项目读错文件；未跟踪与非 Git 项目返回 null。 */
  async headContent(ref: WorkspaceRef, path: string): Promise<string | null> {
    const cwd = await workspacePath(this.target(ref).path, '', 'directory')
    await workspacePath(cwd, path, 'file')
    const git = (args: string[]): Promise<string | null> =>
      new Promise(done => {
        execFile(
          'git',
          args,
          { cwd, windowsHide: true, timeout: 2000, maxBuffer: READ_LIMIT, encoding: 'utf8' },
          (err, out) => done(err ? null : out),
        )
      })
    const prefix = await git(['rev-parse', '--show-prefix'])
    if (prefix === null) return null
    const content = await git(['show', `HEAD:${prefix.trim()}${path.replaceAll('\\', '/')}`])
    return content === null || content.includes('\0') ? null : content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  }

  /** 每文件串行保存；版本不一致禁止覆盖，打开句柄后再次核对原内容。 */
  async save(
    ref: WorkspaceRef,
    path: string,
    content: string,
    version: string,
  ): Promise<Extract<FileDocument, { kind: 'text' }>> {
    if (typeof content !== 'string' || typeof version !== 'string' || !/^[0-9a-f]{64}$/.test(version))
      throw new Error('保存参数不正确')
    if (Buffer.byteLength(content, 'utf8') > TEXT_LIMIT) throw new Error('内容太大，请用外部编辑器保存')
    const root = this.target(ref).path
    const file = await workspacePath(root, path, 'file')
    const previous = this.saves.get(file) ?? Promise.resolve()
    const job = previous
      .catch(() => {})
      .then(async () => {
        const actual = await workspacePath(root, path, 'file')
        if (actual !== file) throw new Error('文件路径已经变化，请重新打开')
        const h = await open(file, 'r')
        const temporary = file + `.pixelsky-${randomUUID()}.tmp`
        try {
          const info = await h.stat()
          if (!info.isFile() || info.size > TEXT_LIMIT) throw new Error('文件已变化，请重新加载')
          const original = await h.readFile()
          if (HASH(original) !== version) throw codedError('files.changedOutside')
          const old = decode(path, original)
          const normalized = content.replace(/\r\n/g, '\n').replace(/\n/g, old.newline === 'crlf' ? '\r\n' : '\n')
          const next = Buffer.concat([
            old.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
            Buffer.from(normalized),
          ])
          if (next.length > TEXT_LIMIT) throw new Error('内容太大，请用外部编辑器保存')
          const output = await open(temporary, 'wx', info.mode)
          try {
            await output.writeFile(next)
            await output.sync()
          } finally {
            await output.close()
          }
          // 临时文件写好后再次核对，写入失败保留原文件；保存不更换符号链接本身。
          if (
            (await workspacePath(root, path, 'file')) !== file ||
            HASH(await boundedRead(file, TEXT_LIMIT)) !== version
          )
            throw codedError('files.changedOutside')
          await h.close()
          await rename(temporary, file)
          return decode(path, next)
        } finally {
          await h.close().catch(() => {})
          await unlink(temporary).catch(() => {})
        }
      })
    this.saves.set(file, job)
    try {
      return await job
    } finally {
      if (this.saves.get(file) === job) this.saves.delete(file)
    }
  }

  async status(ref: WorkspaceRef): Promise<Record<string, string>> {
    const cwd = await workspacePath(this.target(ref).path, '', 'directory')
    return new Promise(resolveStatus => {
      execFile(
        'git',
        ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.'],
        { cwd, windowsHide: true, timeout: 4000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
        async (err, output) => {
          if (err) {
            resolveStatus({})
            return
          }
          // Porcelain 路径相对仓库根，先读取 prefix 以兼容会话 cwd 位于子目录。
          execFile(
            'git',
            ['rev-parse', '--show-prefix'],
            { cwd, windowsHide: true, timeout: 2000, encoding: 'utf8' },
            (prefixError, prefixText) => {
              if (prefixError) {
                resolveStatus({})
                return
              }
              const prefix = prefixText.trim()
              const statuses: Record<string, string> = {}
              const records = output.split('\0')
              for (let i = 0; i < records.length; i++) {
                const row = records[i]
                if (row.length < 4) continue
                const code = row.slice(0, 2).trim()
                const original = row.slice(3)
                if (code.includes('R') || code.includes('C')) i++
                if (prefix && !original.startsWith(prefix)) continue
                const path = original.slice(prefix.length).replace(/\/$/, '')
                statuses[path] =
                  code === '??'
                    ? '?'
                    : code.includes('U')
                      ? '!'
                      : code.includes('D')
                        ? 'D'
                        : code.includes('A')
                          ? 'A'
                          : code.includes('R')
                            ? 'R'
                            : 'M'
              }
              resolveStatus(statuses)
            },
          )
        },
      )
    })
  }
}
