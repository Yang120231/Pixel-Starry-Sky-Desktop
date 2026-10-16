// 不影响使用的引擎警告（docs/ui/ai-commit-codex-warnings-history.md §3）：Codex 读到用户 config.toml 里
// 不认识的设置项、开了开发中的功能时，每轮都会发一条 warning。这类按「提示」显示（灰色、收进执行过程），
// 同一会话只出一次；引擎实时发出和读出旧会话时用同一个判断。以后看到新的同类警告再加进来

const QUIET_WARNINGS: readonly RegExp[] = [
  /^Codex is ignoring \d+ unrecognized configuration settings?\b/i,
  /^Under-development features? enabled\b/i,
]

/** 这条警告是不是只和用户自己的配置有关、不影响使用 */
export function isQuietWarning(text: string): boolean {
  const head = text.trimStart()
  return QUIET_WARNINGS.some(re => re.test(head))
}
