// 引擎「没找到」的提示里带着安装命令（packages/engine 的 discover 写的）：把命令单独拿出来，显示成能一键复制的代码块
/** 认得的安装命令：PowerShell 的 irm … | iex、curl … | bash/sh、npm / pnpm 全局安装、brew、winget */
const COMMAND =
  /(irm\s+\S+\s*\|\s*iex|curl\s+(?:-\S+\s+)*\S+\s*\|\s*(?:bash|sh)|(?:npm|pnpm)\s+(?:i|install|add)\s+-g\s+\S+|brew\s+install\s+\S+|winget\s+install\s+\S+)/

/** 拆成「命令前的文字 / 命令 / 命令后的文字」；没有认得的命令时 command 为 null */
export function splitInstallCommand(message: string): { before: string; command: string | null; after: string } {
  const m = COMMAND.exec(message)
  if (!m) return { before: message, command: null, after: '' }
  return {
    before: message.slice(0, m.index).replace(/[\s:：]+$/, ''),
    command: m[1],
    after: message.slice(m.index + m[1].length).replace(/^[\s。.]+/, ''),
  }
}
