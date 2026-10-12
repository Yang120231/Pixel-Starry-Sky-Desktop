// 上下文明细里记忆文件的路径怎么显示（docs/ui/context-window.md §7）：项目里的写成相对路径，
// 用户目录下的写成 ~ 开头，其余原样；显示时截中间、文件名一直看得见（分成目录和文件名两段，目录那段省略号截断）。

export interface MemoryPathBase {
  /** 会话所在机器的用户目录，不知道时为 null */
  home: string | null
  /** 会话的项目根目录，不知道时为 null */
  root: string | null
  /** Windows 路径：不区分大小写，\ 和 / 都算分隔符 */
  windows: boolean
}

const trimEnd = (path: string): string => path.replace(/[\\/]+$/, '')

/** path 在 dir 里面时，返回 dir 后面那段（不带开头的分隔符）；否则 null */
function inside(path: string, dir: string, windows: boolean): string | null {
  const base = trimEnd(dir)
  if (!base) return null
  const head = path.slice(0, base.length),
    sep = path[base.length]
  const fold = (s: string) => s.replaceAll('\\', '/').toLowerCase()
  const same = windows ? fold(head) === fold(base) : head === base
  if (!same || !(sep === '/' || (windows && sep === '\\'))) return null
  return path.slice(base.length + 1)
}

/** 显示用的路径：项目里 → 相对路径；用户目录下 → ~ 开头（分隔符保持原样）；其余原样 */
export function displayMemoryPath(path: string, base: MemoryPathBase): string {
  const inRoot = base.root ? inside(path, base.root, base.windows) : null
  if (inRoot) return inRoot
  const inHome = base.home ? inside(path, base.home, base.windows) : null
  if (inHome) return '~' + path[trimEnd(base.home!).length] + inHome
  return path
}

/** 分成目录（含结尾的分隔符）和文件名：目录那段可以截断，文件名不截 */
export function splitFileName(path: string): { dir: string; name: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return { dir: path.slice(0, at + 1), name: path.slice(at + 1) }
}
