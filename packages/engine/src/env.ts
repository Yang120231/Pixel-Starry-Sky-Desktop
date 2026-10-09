// 启动引擎时的环境变量（docs/engines.md §7.3）
//
// 从终端（尤其是 Mirasim 的终端）启动像素星空时，会继承别的程序的变量：
// - CLAUDECODE、CLAUDE_CODE_*、CLAUDE_PID、CLAUDE_EFFORT 会让 claude 以为自己是别的 Claude Code 的子会话；
// - MIRASIM_*、ELECTRON_RUN_AS_NODE、ELECTRON_RENDERER_URL、NODE_PATH 是其他程序自己用的。
// ANTHROPIC_*、OPENAI_* 保留：用户可能就是靠它们配置的 Key 或中转。
const DROP =
  /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|MIRASIM_.*|ELECTRON_RUN_AS_NODE|ELECTRON_RENDERER_URL|NODE_PATH)$/i

export function engineEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !DROP.test(k)) env[k] = v
  }
  return env
}
