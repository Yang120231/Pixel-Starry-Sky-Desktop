// 不影响使用的引擎警告（docs/ui/ai-commit-codex-warnings-history.md §3）：Codex 读到用户 config.toml 里
// 不认识的设置项、开了开发中的功能时，每轮都会发一条 warning。这类和哪一轮无关，不进对话：
// 引擎报给宿主，显示在设置 › 本机引擎 › Codex 的「配置提示」里；读出旧会话时把以前存下的去掉。
// 以后看到新的同类警告再加进来

const QUIET_WARNINGS: readonly [key: string, re: RegExp][] = [
  ['unrecognized', /^Codex is ignoring \d+ unrecognized configuration settings?\b/i],
  ['unstable', /^Under-development features? enabled\b/i],
]

/** 配置类警告属于哪一类；同一类新的一条替换旧的（例如改掉一个设置项后「忽略 2 个」变成「忽略 1 个」）。别的警告返回 null */
export function quietWarningKey(text: string): string | null {
  const head = text.trimStart()
  return QUIET_WARNINGS.find(([, re]) => re.test(head))?.[0] ?? null
}

/** 这条警告是不是只和用户自己的配置有关、不影响使用 */
export function isQuietWarning(text: string): boolean {
  return quietWarningKey(text) !== null
}
