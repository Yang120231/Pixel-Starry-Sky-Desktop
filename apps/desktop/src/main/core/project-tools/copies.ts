import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { CopyInput, CopyPreview, ProjectCopy } from '../../../shared/types/project-tools'
import { JsonStore, git, gitInfo, inside, run, samePath, value, type ToolsHost } from './common'

/** 副本目录删不掉时的提示（目录被终端或别的程序当作当前目录） */
const busyMessage = (path: string): string =>
  `副本目录被占用，没删掉：${path}。关掉在这个目录里打开的终端或程序后再删除。`
/** 渲染层靠这段文字识别「残留目录不是空的」并弹出二次确认，不要改 */
export const LEFTOVER_MARK = '残留目录不是空的'

type DirState = 'missing' | 'empty' | 'full'
async function dirState(path: string): Promise<DirState> {
  try {
    return (await readdir(path)).length ? 'full' : 'empty'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'missing'
    if (code === 'ENOTDIR') return 'full'
    throw error
  }
}
/** 删空目录：Windows 上刚释放占用时可能还要等一会儿，重试几次 */
async function removeEmptyDir(path: string, tries = 5, delay = 300): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      await rmdir(path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    }
    if (i < tries - 1) await new Promise(r => setTimeout(r, delay))
  }
  return (await dirState(path)) === 'missing'
}

export class Copies {
  readonly store: JsonStore<{ version: 1; copies: ProjectCopy[] }>
  constructor(
    dir: string,
    private host: ToolsHost,
    private changed: () => void,
    private stopServices: (path: string) => Promise<void>,
  ) {
    this.store = new JsonStore(join(dir, 'copies.json'), { version: 1, copies: [] })
  }
  async init(): Promise<void> {
    await this.store.init()
  }
  get(id: string): ProjectCopy {
    const copy = this.store.data.copies.find(c => c.id === id)
    if (!copy) throw new Error('副本不存在')
    return copy
  }
  async branches(projectId: string): Promise<string[]> {
    const target = this.host.resolve({ projectId })
    return (await git(target.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']))
      .split('\n')
      .filter(Boolean)
  }
  async preview(projectId: string, input: CopyInput): Promise<CopyPreview> {
    if (!input || typeof input !== 'object') throw new Error('参数不正确')
    const target = this.host.resolve({ projectId }),
      info = await gitInfo(target.path)
    if (!info.root || !info.commit) throw new Error('当前项目不是可用的 Git 仓库')
    const name = value(input.name, 80, true),
      branch = value(input.branch, 150, true),
      base = value(input.base || 'HEAD', 150, true)
    if (/[\\/:*?"<>|]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name))
      throw new Error('副本名称不正确')
    await git(info.root, ['check-ref-format', '--branch', branch])
    // Never interpret a user revision as a Git option.
    const commit = await git(info.root, ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'])
    const existing = (await this.branches(projectId)).includes(branch)
    if (input.existingBranch ? !existing : existing)
      throw new Error(input.existingBranch ? '分支不存在' : '分支已经存在')
    const hash = createHash('sha256')
      .update(await realpath(info.root))
      .digest('hex')
      .slice(0, 8)
    const defaultBase = join(dirname(info.root), '.pixelsky', 'worktrees', basename(info.root) + '-' + hash)
    const path = input.directory ? resolve(value(input.directory, 1000, true)) : join(defaultBase, name)
    if (!isAbsolute(path) || samePath(path, info.root)) throw new Error('副本目录不正确')
    // 上次删除没清干净的登记先清掉；空目录可以直接用（git worktree add 支持空目录）
    await git(info.root, ['worktree', 'prune']).catch(() => '')
    if ((await dirState(path)) === 'full') throw new Error('目标目录已经存在，可能是上次删除没清干净：' + path)
    return {
      input: { name, branch, existingBranch: input.existingBranch === true, base, directory: path },
      path,
      commit,
      branch,
      root: info.root,
    }
  }
  async create(projectId: string, input: CopyInput): Promise<ProjectCopy> {
    let created: { root: string; path: string } | null = null
    let result: ProjectCopy
    try {
      result = await this.store.transaction(async data => {
        const preview = await this.preview(projectId, input)
        if (data.copies.some(c => samePath(c.path, preview.path))) throw new Error('同名副本已经存在')
        await mkdir(dirname(preview.path), { recursive: true })
        // 不设超时：worktree add 先登记、建分支再检出，大仓库检出超过 2 分钟被打断会留下应用里看不到的半成品
        await run(
          'git',
          [
            '-C',
            preview.root,
            'worktree',
            'add',
            ...(input.existingBranch ? [] : ['-b', preview.branch]),
            '--',
            preview.path,
            input.existingBranch ? preview.branch : preview.commit,
          ],
          undefined,
          0,
        )
        created = { root: preview.root, path: preview.path }
        const now = Date.now(),
          copy: ProjectCopy = {
            id: randomUUID(),
            projectId,
            name: preview.input.name,
            path: await realpath(preview.path),
            branch: preview.branch,
            baseCommit: preview.commit,
            baseBranch: preview.input.base,
            createdAt: now,
            updatedAt: now,
            dirty: false,
            changedCount: 0,
            ahead: 0,
            behind: 0,
            sessions: [],
            error: null,
          }
        data.copies.push(copy)
        return copy
      })
    } catch (error) {
      // Roll back only an untouched worktree created by this attempt. The branch is retained.
      const pending = created as { root: string; path: string } | null
      if (pending) {
        try {
          await git(pending.root, ['worktree', 'remove', '--', pending.path])
        } catch {
          throw new Error(String(error) + '\n' + pending.path)
        }
      }
      throw error
    }
    this.changed()
    return result
  }
  async verify(copy: ProjectCopy): Promise<void> {
    const target = this.host.resolve({ projectId: copy.projectId })
    const list = await git(target.path, ['worktree', 'list', '--porcelain', '-z'])
    const paths = list
      .split('\0')
      .filter(part => part.startsWith('worktree '))
      .map(part => part.slice(9))
    if (!paths.some(path => samePath(path, copy.path)) || samePath(copy.path, target.path))
      throw new Error('工作树不存在或不是 Git 工作树')
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
      const counts = (await git(copy.path, ['rev-list', '--left-right', '--count', copy.baseCommit + '...HEAD']))
        .split(/\s+/)
        .map(Number)
      return {
        ...copy,
        branch: info.branch ?? copy.branch,
        dirty: info.dirty,
        changedCount: info.changedCount,
        ahead: counts[1] || 0,
        behind: counts[0] || 0,
        sessions: this.host.sessions(copy.path),
        error: null,
      }
    } catch {
      return { ...copy, sessions: this.host.sessions(copy.path), error: '工作树不存在或不是 Git 工作树' }
    }
  }
  async list(projectId: string): Promise<ProjectCopy[]> {
    this.host.resolve({ projectId })
    return Promise.all(this.store.data.copies.filter(c => c.projectId === projectId).map(c => this.status(c)))
  }
  async open(id: string) {
    const copy = this.get(id)
    await this.verify(copy)
    const record = this.host.create(copy.projectId, copy.path)
    this.changed()
    return record
  }
  private async registered(projectPath: string, path: string): Promise<boolean> {
    const list = await git(projectPath, ['worktree', 'list', '--porcelain', '-z'])
    return list
      .split('\0')
      .filter(part => part.startsWith('worktree '))
      .some(part => samePath(part.slice(9), path))
  }
  async remove(id: string, force = false): Promise<void> {
    await this.store.transaction(async data => {
      const copy = this.get(id)
      const target = this.host.resolve({ projectId: copy.projectId })
      // 只删记录里的副本目录：不能是项目目录，也不能包住项目目录
      // Windows 路径不分大小写，比较前统一成小写
      const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
      if (samePath(copy.path, target.path) || inside(fold(copy.path), fold(target.path)))
        throw new Error('副本目录不正确')
      let valid = true
      try {
        await this.verify(copy)
      } catch {
        valid = false
      }
      if (!valid) {
        await this.removeLeftover(copy, target.path, force)
        data.copies = data.copies.filter(c => c.id !== id)
        return
      }
      const current = await this.status(copy)
      if (current.dirty && !force) throw new Error('副本有未提交修改，请再次确认删除')
      await this.host.withStopped(copy.path, async () => {
        await this.stopServices(copy.path)
        // Recheck after stopping active writers.
        const after = await gitInfo(copy.path)
        if (after.dirty && !force) throw new Error('副本有未提交修改，请再次确认删除')
        try {
          await git(target.path, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', copy.path])
        } catch (error) {
          // 目录被别的进程占着时 git 会删掉文件、注销工作树，但删不掉目录本身
          if (await this.registered(target.path, copy.path)) throw error
          const state = await dirState(copy.path)
          if (state !== 'missing' && !(state === 'empty' && (await removeEmptyDir(copy.path))))
            throw new Error(busyMessage(copy.path))
        }
        data.copies = data.copies.filter(c => c.id !== id)
      })
    })
    this.changed()
  }
  /** 副本已经不是有效的工作树（git 已注销、或目录被外部删除）：清理残留目录 */
  private async removeLeftover(copy: ProjectCopy, projectPath: string, force: boolean): Promise<void> {
    await git(projectPath, ['worktree', 'prune']).catch(() => '')
    if (await this.registered(projectPath, copy.path)) throw new Error('工作树仍在 Git 登记中，无法清理：' + copy.path)
    const state = await dirState(copy.path)
    if (state === 'missing') return
    if (state === 'full' && !force) throw new Error(`${LEFTOVER_MARK}：${copy.path}，确认后会连同里面的文件一起删除`)
    await this.host.withStopped(copy.path, async () => {
      await this.stopServices(copy.path)
      if (state === 'empty') {
        if (!(await removeEmptyDir(copy.path))) throw new Error(busyMessage(copy.path))
        return
      }
      try {
        await rm(copy.path, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 })
      } catch {
        throw new Error(busyMessage(copy.path))
      }
    })
  }
  async forget(id: string): Promise<void> {
    await this.store.transaction(data => {
      data.copies = data.copies.filter(c => c.id !== id)
    })
    this.changed()
  }
}
