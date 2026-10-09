import { randomUUID, createHash } from 'node:crypto'
import { mkdir, realpath, lstat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { CopyInput, CopyPreview, ProjectCopy } from '../../preload/project-tools'
import { JsonStore, git, gitInfo, samePath, value, type ToolsHost } from './common'

export class Copies {
  readonly store: JsonStore<{ version: 1; copies: ProjectCopy[] }>
  constructor(dir: string, private host: ToolsHost, private changed: () => void, private stopServices: (path: string) => Promise<void>) {
    this.store = new JsonStore(join(dir, 'copies.json'), { version: 1, copies: [] })
  }
  async init(): Promise<void> { await this.store.init() }
  get(id: string): ProjectCopy {
    const copy = this.store.data.copies.find(c => c.id === id)
    if (!copy) throw new Error('副本不存在')
    return copy
  }
  async branches(projectId: string): Promise<string[]> {
    const target = this.host.resolve({ projectId })
    return (await git(target.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).split('\n').filter(Boolean)
  }
  async preview(projectId: string, input: CopyInput): Promise<CopyPreview> {
    if (!input || typeof input !== 'object') throw new Error('参数不正确')
    const target = this.host.resolve({ projectId }), info = await gitInfo(target.path)
    if (!info.root || !info.commit) throw new Error('当前项目不是可用的 Git 仓库')
    const name = value(input.name, 80, true), branch = value(input.branch, 150, true), base = value(input.base || 'HEAD', 150, true)
    if (/[\\/:*?"<>|]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name)) throw new Error('副本名称不正确')
    await git(info.root, ['check-ref-format', '--branch', branch])
    // Never interpret a user revision as a Git option.
    const commit = await git(info.root, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'])
    const existing = (await this.branches(projectId)).includes(branch)
    if (input.existingBranch ? !existing : existing) throw new Error(input.existingBranch ? '分支不存在' : '分支已经存在')
    const hash = createHash('sha256').update(await realpath(info.root)).digest('hex').slice(0, 8)
    const defaultBase = join(dirname(info.root), '.pixelsky', 'worktrees', basename(info.root) + '-' + hash)
    const path = input.directory ? resolve(value(input.directory, 1000, true)) : join(defaultBase, name)
    if (!isAbsolute(path) || samePath(path, info.root)) throw new Error('副本目录不正确')
    try { await lstat(path); throw new Error('目标目录已经存在') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return { input: { name, branch, existingBranch: input.existingBranch === true, base, directory: path }, path, commit, branch, root: info.root }
  }
  async create(projectId: string, input: CopyInput): Promise<ProjectCopy> {
    let created: { root: string; path: string } | null = null
    let result: ProjectCopy
    try { result = await this.store.transaction(async data => {
      const preview = await this.preview(projectId, input)
      if (data.copies.some(c => samePath(c.path, preview.path))) throw new Error('同名副本已经存在')
      await mkdir(dirname(preview.path), { recursive: true })
      await git(preview.root, ['worktree', 'add', ...(input.existingBranch ? [] : ['-b', preview.branch]), '--', preview.path, input.existingBranch ? preview.branch : preview.commit])
      created = { root: preview.root, path: preview.path }
      const now = Date.now(), copy: ProjectCopy = {
        id: randomUUID(), projectId, name: preview.input.name, path: await realpath(preview.path), branch: preview.branch,
        baseCommit: preview.commit, baseBranch: preview.input.base, createdAt: now, updatedAt: now,
        dirty: false, changedCount: 0, ahead: 0, behind: 0, sessions: [], error: null,
      }
      data.copies.push(copy); return copy
    })
    } catch (error) {
      // Roll back only an untouched worktree created by this attempt. The branch is retained.
      const pending = created as { root: string; path: string } | null
      if (pending) { try { await git(pending.root, ['worktree', 'remove', '--', pending.path]) } catch { throw new Error(String(error) + '\n' + pending.path) } }
      throw error
    }
    this.changed(); return result
  }
  async verify(copy: ProjectCopy): Promise<void> {
    const target = this.host.resolve({ projectId: copy.projectId })
    const list = await git(target.path, ['worktree', 'list', '--porcelain', '-z'])
    const paths = list.split('\0').filter(part => part.startsWith('worktree ')).map(part => part.slice(9))
    if (!paths.some(path => samePath(path, copy.path)) || samePath(copy.path, target.path)) throw new Error('工作树不存在或不是 Git 工作树')
    const root = await git(copy.path, ['rev-parse', '--show-toplevel'])
    if (!samePath(root, copy.path)) throw new Error('工作树不存在或不是 Git 工作树')
  }
  async verifyPath(projectId: string, path: string): Promise<void> {
    const target = this.host.resolve({ projectId })
    if (samePath(target.path, path)) return
    const copy = this.store.data.copies.find(c => c.projectId === projectId && samePath(c.path, path))
    if (!copy) throw new Error('副本不存在')
    await this.verify(copy)
  }
  async status(copy: ProjectCopy): Promise<ProjectCopy> {
    try {
      await this.verify(copy)
      const info = await gitInfo(copy.path)
      const counts = (await git(copy.path, ['rev-list', '--left-right', '--count', copy.baseCommit + '...HEAD'])).split(/\s+/).map(Number)
      return { ...copy, branch: info.branch ?? copy.branch, dirty: info.dirty, changedCount: info.changedCount, ahead: counts[1] || 0, behind: counts[0] || 0, sessions: this.host.sessions(copy.path), error: null }
    } catch { return { ...copy, sessions: this.host.sessions(copy.path), error: '工作树不存在或不是 Git 工作树' } }
  }
  async list(projectId: string): Promise<ProjectCopy[]> {
    this.host.resolve({ projectId })
    return Promise.all(this.store.data.copies.filter(c => c.projectId === projectId).map(c => this.status(c)))
  }
  async open(id: string) {
    const copy = this.get(id); await this.verify(copy)
    const record = this.host.create(copy.projectId, copy.path)
    this.changed(); return record
  }
  async remove(id: string, force = false): Promise<void> {
    await this.store.transaction(async data => {
      const copy = this.get(id); await this.verify(copy)
      const current = await this.status(copy)
      if (current.dirty && !force) throw new Error('副本有未提交修改，请再次确认删除')
      await this.host.withStopped(copy.path, async () => {
      await this.stopServices(copy.path)
      // Recheck after stopping active writers.
      const after = await gitInfo(copy.path)
      if (after.dirty && !force) throw new Error('副本有未提交修改，请再次确认删除')
      const target = this.host.resolve({ projectId: copy.projectId })
      await git(target.path, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', copy.path])
      data.copies = data.copies.filter(c => c.id !== id)
      })
    })
    this.changed()
  }
  async forget(id: string): Promise<void> {
    await this.store.transaction(data => { data.copies = data.copies.filter(c => c.id !== id) }); this.changed()
  }
}
