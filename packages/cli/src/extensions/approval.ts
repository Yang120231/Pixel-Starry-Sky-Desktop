// 工具调用批准扩展：每次 tool_call 前按权限模式决定 放行 / 拒绝 / 询问。
// 询问走 ctx.ui.confirm（RPC 模式下变成 extension_ui_request，由桌面界面回答）；
// 没有界面（print / json 模式）时无法询问，直接拒绝并说明原因。
// 只用可擦除的 TS 语法。
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'

export const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/** 只读工具：任何模式都放行 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['read', 'ls', 'find', 'grep'])
/** 无副作用的内部工具（待办、按需加载工具）：任何模式都放行 */
export const SAFE_INTERNAL_TOOLS: ReadonlySet<string> = new Set(['todo_write', 'tool_search'])
/** acceptEdits 下自动放行的编辑类工具 */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['edit', 'write'])

export const PERMISSION_FLAG = 'permission-mode'
export const PERMISSION_ENV = 'PIXELSKY_PERMISSION_MODE'
/** 运行中切换权限模式的扩展命令（`/pixelsky-mode <mode>`），桌面端适配器用 */
export const MODE_COMMAND = 'pixelsky-mode'

export type PermissionDecision = { action: 'allow' } | { action: 'block'; reason: string } | { action: 'ask' }

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

/**
 * 解析权限模式：命令行参数优先，其次环境变量，默认 default。
 * 值不合法时回落 default（最严格的可交互模式）并返回警告文字。
 */
export function resolvePermissionMode(
  flagValue: string | boolean | undefined,
  envValue: string | undefined,
): { mode: PermissionMode; warning?: string } {
  const raw = typeof flagValue === 'string' && flagValue !== '' ? flagValue : envValue?.trim() || undefined
  if (raw === undefined) return { mode: 'default' }
  if (isPermissionMode(raw)) return { mode: raw }
  return {
    mode: 'default',
    warning: `未知的权限模式 "${raw}"，已改用 default（可选：${PERMISSION_MODES.join(' / ')}）/ Unknown permission mode "${raw}", using default.`,
  }
}

/** 纯函数：不带副作用，便于测试。 */
export function decidePermission(input: {
  mode: PermissionMode
  toolName: string
  hasUI: boolean
}): PermissionDecision {
  const { mode, toolName, hasUI } = input
  if (mode === 'bypassPermissions') return { action: 'allow' }
  if (READ_ONLY_TOOLS.has(toolName) || SAFE_INTERNAL_TOOLS.has(toolName)) return { action: 'allow' }
  if (mode === 'plan') {
    return {
      action: 'block',
      reason: `Tool "${toolName}" is blocked: the session is in plan mode (read-only). Use read/ls/find/grep to investigate, then present your plan to the user instead of making changes.`,
    }
  }
  if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) return { action: 'allow' }
  // edit / write（default 模式）、bash / powershell 和未知工具（含 MCP 工具）：要问用户
  if (!hasUI) {
    return {
      action: 'block',
      reason: `Tool "${toolName}" requires user approval, but no interactive UI is available (mode "${mode}"). Run with --permission-mode bypassPermissions to allow it without asking.`,
    }
  }
  return { action: 'ask' }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 给询问对话框用的一行摘要 */
export function describeToolCall(_toolName: string, input: unknown): string {
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (typeof record.command === 'string') return clip(record.command, 800)
  if (typeof record.path === 'string') return clip(record.path, 400)
  if (typeof record.file_path === 'string') return clip(record.file_path, 400)
  try {
    return clip(JSON.stringify(record), 800)
  } catch {
    return ''
  }
}

/** 创建批准扩展；mode 不传时在首次工具调用时从 --permission-mode / 环境变量读取。 */
export function createApprovalExtension(options: { mode?: PermissionMode } = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerFlag(PERMISSION_FLAG, {
      type: 'string',
      description: `Permission mode: ${PERMISSION_MODES.join(' | ')} (default: default; env ${PERMISSION_ENV})`,
    })

    let mode: PermissionMode | undefined = options.mode
    const currentMode = (): PermissionMode => {
      if (mode) return mode
      const resolved = resolvePermissionMode(pi.getFlag(PERMISSION_FLAG), process.env[PERMISSION_ENV])
      if (resolved.warning) console.error(resolved.warning)
      mode = resolved.mode
      return mode
    }

    // 运行中切换权限模式：桌面端（RPC）发 prompt "/pixelsky-mode <mode>"，扩展命令立即执行、不进模型（disposition: handled）。
    pi.registerCommand(MODE_COMMAND, {
      description: `Switch the permission mode at runtime: ${PERMISSION_MODES.join(' | ')}`,
      handler: async (args, ctx) => {
        const next = args.trim()
        if (!isPermissionMode(next)) {
          ctx.ui.notify(
            `未知的权限模式 "${next}"（可选：${PERMISSION_MODES.join(' / ')}）/ Unknown permission mode "${next}".`,
            'error',
          )
          return
        }
        mode = next
      },
    })

    pi.on('tool_call', async (event, ctx) => {
      const decision = decidePermission({ mode: currentMode(), toolName: event.toolName, hasUI: ctx.hasUI })
      if (decision.action === 'allow') return undefined
      if (decision.action === 'block') return { block: true, reason: decision.reason }
      const approved = await ctx.ui.confirm(
        `允许工具 ${event.toolName}？ / Allow tool ${event.toolName}?`,
        describeToolCall(event.toolName, event.input),
      )
      return approved ? undefined : { block: true, reason: `The user denied the "${event.toolName}" tool call.` }
    })
  }
}
