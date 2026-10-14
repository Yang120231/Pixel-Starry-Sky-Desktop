import { describe, expect, it } from 'vitest'
import {
  PERMISSION_MODES,
  createApprovalExtension,
  decidePermission,
  describeToolCall,
  resolvePermissionMode,
  type PermissionMode,
} from '../src/extensions/approval.ts'

const decide = (mode: PermissionMode, toolName: string, hasUI = true) =>
  decidePermission({ mode, toolName, hasUI }).action

describe('decidePermission', () => {
  it('default: 只读放行，编辑 / shell / 未知工具询问', () => {
    for (const t of ['read', 'ls', 'find', 'grep', 'todo_write']) expect(decide('default', t)).toBe('allow')
    for (const t of ['edit', 'write', 'bash', 'powershell', 'mcp__x__y', 'codemode'])
      expect(decide('default', t)).toBe('ask')
  })

  it('acceptEdits: edit / write 放行，shell 与未知工具询问', () => {
    expect(decide('acceptEdits', 'edit')).toBe('allow')
    expect(decide('acceptEdits', 'write')).toBe('allow')
    expect(decide('acceptEdits', 'bash')).toBe('ask')
    expect(decide('acceptEdits', 'powershell')).toBe('ask')
    expect(decide('acceptEdits', 'mystery')).toBe('ask')
  })

  it('bypassPermissions: 全部放行（含没有界面时）', () => {
    for (const t of ['read', 'edit', 'bash', 'mystery']) expect(decide('bypassPermissions', t, false)).toBe('allow')
  })

  it('plan: 只读放行，其余拒绝并说明在计划模式', () => {
    expect(decide('plan', 'grep')).toBe('allow')
    for (const t of ['edit', 'write', 'bash', 'powershell', 'mystery']) {
      const d = decidePermission({ mode: 'plan', toolName: t, hasUI: true })
      expect(d.action).toBe('block')
      expect(d.action === 'block' && d.reason).toContain('plan mode')
    }
  })

  it('没有界面时，需要询问的一律拒绝并给出原因', () => {
    for (const mode of ['default', 'acceptEdits'] as const) {
      const d = decidePermission({ mode, toolName: 'bash', hasUI: false })
      expect(d.action).toBe('block')
      expect(d.action === 'block' && d.reason).toContain('no interactive UI')
    }
    expect(decide('default', 'read', false)).toBe('allow')
    expect(decide('acceptEdits', 'edit', false)).toBe('allow')
  })
})

describe('resolvePermissionMode', () => {
  it('命令行参数优先于环境变量，默认 default', () => {
    expect(resolvePermissionMode(undefined, undefined).mode).toBe('default')
    expect(resolvePermissionMode(undefined, 'plan').mode).toBe('plan')
    expect(resolvePermissionMode('acceptEdits', 'plan').mode).toBe('acceptEdits')
    expect(resolvePermissionMode('', 'plan').mode).toBe('plan')
  })

  it('不认识的值回落 default 并给警告', () => {
    const r = resolvePermissionMode('yolo', undefined)
    expect(r.mode).toBe('default')
    expect(r.warning).toContain('yolo')
    for (const m of PERMISSION_MODES) expect(resolvePermissionMode(m, undefined).warning).toBeUndefined()
  })
})

describe('describeToolCall', () => {
  it('优先显示命令 / 路径并截断', () => {
    expect(describeToolCall('bash', { command: 'ls -la' })).toBe('ls -la')
    expect(describeToolCall('edit', { path: 'a.ts' })).toBe('a.ts')
    expect(describeToolCall('bash', { command: 'x'.repeat(2000) }).length).toBe(801)
  })
})

describe('createApprovalExtension', () => {
  function setup(mode: PermissionMode, hasUI: boolean, confirmAnswer = true) {
    const handlers: Record<string, (event: unknown, ctx: unknown) => Promise<unknown>> = {}
    const flags: string[] = []
    const confirms: string[][] = []
    const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {}
    const pi = {
      registerFlag: (name: string) => flags.push(name),
      registerCommand: (name: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
        commands[name] = def.handler
      },
      getFlag: () => undefined,
      on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        handlers[name] = handler
      },
    }
    createApprovalExtension({ mode })(pi as never)
    const ctx = {
      hasUI,
      ui: {
        confirm: async (title: string, message: string) => {
          confirms.push([title, message])
          return confirmAnswer
        },
      },
    }
    const call = (toolName: string, input: unknown) => handlers.tool_call({ type: 'tool_call', toolName, input }, ctx)
    const notices: string[] = []
    const setMode = (args: string) =>
      commands['pixelsky-mode'](args, { ui: { notify: (message: string) => notices.push(message) } })
    return { flags, confirms, call, setMode, notices }
  }

  it('注册 --permission-mode 参数', () => {
    expect(setup('default', true).flags).toContain('permission-mode')
  })

  it('询问时用户同意放行、拒绝则 block', async () => {
    const yes = setup('default', true, true)
    expect(await yes.call('bash', { command: 'rm -rf x' })).toBeUndefined()
    expect(yes.confirms[0][1]).toBe('rm -rf x')
    const no = setup('default', true, false)
    expect(await no.call('bash', { command: 'rm -rf x' })).toMatchObject({ block: true })
  })

  it('/pixelsky-mode 运行中切换权限模式；不认识的值提示并保持原模式', async () => {
    const s = setup('default', true)
    expect(await s.call('write', { path: 'a' })).toBeUndefined()
    expect(s.confirms).toHaveLength(1)
    await s.setMode('plan')
    expect(await s.call('write', { path: 'a' })).toMatchObject({ block: true })
    await s.setMode('nope')
    expect(s.notices).toHaveLength(1)
    expect(await s.call('write', { path: 'a' })).toMatchObject({ block: true })
    await s.setMode(' bypassPermissions ')
    expect(await s.call('bash', { command: 'x' })).toBeUndefined()
    expect(s.confirms).toHaveLength(1)
  })

  it('没有界面时不询问直接 block；只读工具不询问', async () => {
    const s = setup('default', false)
    expect(await s.call('write', { path: 'a' })).toMatchObject({ block: true })
    expect(await s.call('read', { path: 'a' })).toBeUndefined()
    expect(s.confirms).toHaveLength(0)
  })
})
