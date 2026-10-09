// 远端没有系统回收站：Git 面板放弃的未跟踪文件移到 <数据目录>/trash/<时间戳>/<相对路径>（docs/ui/git-panel.md §2.4）
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inside } from './common'

export interface TrashFile {
  /** 文件的绝对路径（已核对在仓库内） */
  absolute: string
  /** 相对仓库根目录的路径，用来在回收目录里还原层级 */
  relative: string
}

/** 一次放弃的文件放进同一个时间戳目录；目录重名时加序号。返回这次的目录。 */
export async function moveToTrash(
  root: string,
  files: TrashFile[],
  opts: { now?: Date; move?: (from: string, to: string) => Promise<void> } = {},
): Promise<string> {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
  await mkdir(root, { recursive: true, mode: 0o700 })
  let dir = join(root, stamp)
  for (let n = 1; ; n++) {
    try {
      await mkdir(dir, { mode: 0o700 })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      dir = join(root, `${stamp}-${n}`)
    }
  }
  const move = opts.move ?? rename
  for (const file of files) {
    const target = join(dir, file.relative)
    if (!inside(dir, target) || target === dir) throw new Error('参数不正确')
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    try {
      await move(file.absolute, target)
    } catch (err) {
      // 数据目录和项目不在同一个文件系统：复制后删除原文件
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      await cp(file.absolute, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
      await rm(file.absolute, { recursive: true, force: true })
    }
  }
  return dir
}
