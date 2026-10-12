// 列电脑上的子目录（加项目时选文件夹）：SSH 机器的辅助进程（machines:directories）和手机的「加项目」共用
import { readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute } from 'node:path'
import { value } from './args'

export interface DirectoryChoices {
  path: string
  /** 上一级；已经是根目录时为 null */
  parent: string | null
  /** 子目录名，按名字排，最多 2000 个 */
  directories: string[]
}

/** 不传时从用户主目录开始 */
export async function listDirectories(input?: unknown): Promise<DirectoryChoices> {
  const path = await realpath(input ? value(input, 4096, true) : homedir())
  if (!isAbsolute(path)) throw new Error('目录不正确')
  const directories = (await readdir(path, { withFileTypes: true }))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .slice(0, 2000)
  return { path, parent: dirname(path) === path ? null : dirname(path), directories }
}
