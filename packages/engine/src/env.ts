// 启动引擎时的环境变量（docs/engines.md §7.3）
//
// 从终端（尤其是 Mirasim 的终端）启动像素星空时，会继承别的程序的变量：
// - CLAUDECODE、CLAUDE_PID、CLAUDE_EFFORT 和下面列出的 CLAUDE_CODE_* 会让 claude 以为自己是别的 Claude Code 的子会话；
// - MIRASIM_*、ELECTRON_RUN_AS_NODE、ELECTRON_RENDERER_URL、NODE_PATH 是其他程序自己用的。
// ANTHROPIC_*、OPENAI_* 保留：用户可能就是靠它们配置的 Key 或中转。
// 其余 CLAUDE_CODE_* 是用户的配置（CLAUDE_CODE_GIT_BASH_PATH、CLAUDE_CODE_OAUTH_TOKEN、CLAUDE_CODE_USE_BEDROCK /
// VERTEX、CLAUDE_CODE_MAX_OUTPUT_TOKENS、CLAUDE_CODE_DISABLE_* …），保留；原来整类丢掉，靠它们登录 / 运行的用户用不了。
// 网关会话要清掉的认证类变量在 claude/index.ts 的 launchEnv 里单独处理。
const DROP =
  /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|EXECPATH|CHILD_SESSION|MESSAGING_.*|SESSION_ATTENDED|ENABLE_SDK_FILE_CHECKPOINTING)|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AUTOCOMPACT_PCT_OVERRIDE|MIRASIM_.*|ELECTRON_RUN_AS_NODE|ELECTRON_RENDERER_URL|NODE_PATH)$/i

export function engineEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !DROP.test(k)) env[k] = v
  }
  return env
}
