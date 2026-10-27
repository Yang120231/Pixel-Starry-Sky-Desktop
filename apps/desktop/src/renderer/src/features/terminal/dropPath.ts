// 拖进终端的文件路径按 Shell 加引号（docs/ui/terminal-small-polish.md §1）：只在有空格或特殊字符时加

/** 不用加引号的字符：英文字母数字和 . / \ : - _（cmd 把 , = 当分隔符、PowerShell 开头的 @ 有含义，都加引号） */
const PLAIN = /^[\w./\\:-]+$/
const POSIX_SHELLS = ['git-bash', 'bash', 'zsh']

/**
 * profileId 是终端的 Shell（pwsh、powershell、cmd、git-bash、bash、zsh，自定义的是别的 id）；
 * windows：本机是不是 Windows（自定义 Shell 按它选引号）
 */
export function quotePath(path: string, profileId: string, windows: boolean): string {
  if (profileId === 'git-bash') path = path.replace(/\\/g, '/')
  const powershell = profileId === 'pwsh' || profileId === 'powershell'
  const doubleQuotes = profileId === 'cmd' || (windows && !powershell && !POSIX_SHELLS.includes(profileId))
  // bash / zsh 把没加引号的 \ 当转义（Linux 上文件名里可以有 \）
  if (PLAIN.test(path) && (powershell || doubleQuotes || !path.includes('\\'))) return path
  // PowerShell 把弯引号 ‘ ’ ‚ ‛ 也当单引号：和 ' 一样写两个，不然文件名能结束引号、接着跑别的命令
  if (powershell) return `'${path.replace(/['‘’‚‛]/g, c => c + c)}'`
  if (doubleQuotes) return `"${path}"`
  return `'${path.replace(/'/g, "'\\''")}'`
}
