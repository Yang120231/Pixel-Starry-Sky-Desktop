// 项目脚本用哪个包管理器运行（docs/ui/files-search-terminal-pins.md §4.3），主进程和界面共用：
// package.json 的 packageManager 字段优先，其次看锁文件，都没有就用 npm。
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
]

export const LOCKFILE_NAMES = LOCKFILES.map(([name]) => name)

export function detectPackageManager(field: unknown, present: (name: string) => boolean): PackageManager {
  const declared = typeof field === 'string' ? /^(npm|pnpm|yarn|bun)@/.exec(field)?.[1] : undefined
  if (declared) return declared as PackageManager
  return LOCKFILES.find(([name]) => present(name))?.[1] ?? 'npm'
}

/** 运行一个 package.json 脚本的命令；脚本名已按 [\w:.-]+ 过滤，不需要再加引号 */
export function scriptCommand(manager: PackageManager, name: string): string {
  return `${manager} run ${name}`
}
