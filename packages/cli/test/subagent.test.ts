import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { ALLOW_OPTION, ALWAYS_OPTION, APPROVAL_OPTIONS, approvalTitle } from '../src/extensions/approval.ts'
import {
  APPROVAL_CONTEXT_STATUS,
  SUBAGENT_TOOL,
  createSubagentExtension,
  matchChildCall,
} from '../src/tools/subagent.ts'

type Json = Record<string, unknown>

/** 假的子进程（--mode rpc）：回 get_state 等请求；prompt 之后跑 script，结束时发 agent_settled */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly received: Json[] = []
  private waiting = new Map<string, (m: Json) => void>()
  readonly stdin: Writable
  constructor(script: (child: FakeChild) => Promise<void>) {
    super()
    let buf = ''
    this.stdin = new Writable({
      write: (chunk, _enc, done) => {
        buf += String(chunk)
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const m = JSON.parse(buf.slice(0, i)) as Json
          buf = buf.slice(i + 1)
          this.received.push(m)
          if (m.type === 'extension_ui_response') this.waiting.get(String(m.id))?.(m)
          else if (m.type !== 'abort') {
            this.send({ type: 'response', id: m.id, command: m.type, success: true, data: {} })
            if (m.type === 'prompt') void script(this).then(() => this.send({ type: 'agent_settled' }))
          }
        }
        done()
      },
      final: done => {
        setImmediate(() => this.emit('exit', 0))
        done()
      },
    })
  }
  send(m: Json): void {
    this.stdout.write(JSON.stringify(m) + '\n')
  }
  /** 发一个对话框请求，等主进程回 */
  ask(m: Json): Promise<Json> {
    return new Promise(resolve => {
      this.waiting.set(String(m.id), resolve)
      this.send({ type: 'extension_ui_request', ...m })
    })
  }
  kill(): void {
    this.emit('exit', null)
  }
}

function harness(answer: string | undefined, allowed: (key: string) => boolean = () => false) {
  const events: string[] = []
  const remembered: string[] = []
  let tool: { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> } | null = null
  let child: FakeChild | null = null
  const writeArgs = { path: 'a.txt', content: 'from child' }
  createSubagentExtension({
    mode: () => 'default',
    rules: { allowed, remember: key => remembered.push(key) },
    spawnChild: () => {
      child = new FakeChild(async c => {
        // 先来一个别的调用（摘要不同），要批准的是第二个 write
        c.send({
          type: 'tool_execution_start',
          toolCallId: 'k0',
          toolName: 'write',
          args: { path: 'other.txt', content: '' },
        })
        c.send({ type: 'tool_execution_start', toolCallId: 'k1', toolName: 'write', args: writeArgs })
        const reply = await c.ask({
          id: 'u1',
          method: 'select',
          title: approvalTitle('write', writeArgs),
          options: [...APPROVAL_OPTIONS],
        })
        events.push(`child got ${String(reply.value ?? 'cancelled')}`)
        c.send({ type: 'tool_execution_end', toolCallId: 'k1', toolName: 'write' })
        c.send({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: { input: 1, output: 1 } },
        })
      })
      return child as never
    },
  })({
    registerTool: (t: never) => (tool = t),
    getThinkingLevel: () => 'off',
    appendEntry: () => {},
  } as never)
  const ctx = {
    cwd: process.cwd(),
    mode: 'rpc',
    model: undefined,
    sessionManager: { getSessionFile: () => undefined },
    ui: {
      setStatus: (key: string, text: string) => events.push(`status ${key} ${text}`),
      select: async (title: string) => {
        events.push(`select ${title.split('\n')[0]}`)
        return answer
      },
      notify: () => {},
    },
  }
  const run = () => tool!.execute('t1', { description: '写文件', prompt: 'write a.txt' }, undefined, undefined, ctx)
  return { run, events, remembered, writeArgs, child: () => child! }
}

describe('子智能体：转过来的审批', () => {
  it('对得上子进程里是哪次调用：摘要一样的优先，问过的不再对', () => {
    const calls = new Map([
      ['k0', { name: 'write', args: { path: 'other.txt' }, asked: false }],
      ['k1', { name: 'write', args: { path: 'a.txt' }, asked: false }],
      ['k2', { name: 'bash', args: { command: 'ls' }, asked: false }],
    ])
    expect(matchChildCall(calls, approvalTitle('write', { path: 'a.txt' }))?.[0]).toBe('k1')
    expect(matchChildCall(calls, approvalTitle('bash', { command: 'ls' }))?.[0]).toBe('k2')
    // 摘要对不上时退回同名最早的，问过的跳过
    calls.get('k0')!.asked = true
    expect(matchChildCall(calls, approvalTitle('write', { path: 'zzz' }))?.[0]).toBe('k1')
    expect(matchChildCall(calls, '别的对话框')).toBeNull()
  })

  it('弹审批前报上下文（主会话的 task 调用 + 子进程的参数），选了「本会话不再询问」主会话也记上', async () => {
    const h = harness(ALWAYS_OPTION)
    const result = await h.run()
    expect(result.content[0].text).toBe('done')
    const status = h.events.find(e => e.startsWith(`status ${APPROVAL_CONTEXT_STATUS} `))!
    expect(JSON.parse(status.slice(`status ${APPROVAL_CONTEXT_STATUS} `.length))).toMatchObject({
      toolCallId: 't1',
      label: '写文件',
      tool: 'write',
      args: h.writeArgs,
    })
    // 报上下文紧挨在弹框前面
    expect(h.events.indexOf(status) + 1).toBe(h.events.indexOf('select 允许工具 write？ / Allow tool write?'))
    expect(h.events).toContain(`child got ${ALWAYS_OPTION}`)
    expect(h.remembered).toEqual(['write'])
    expect(SUBAGENT_TOOL).toBe('task')
  })

  it('主会话已经「不再询问」的：直接允许，不弹框', async () => {
    const h = harness(undefined, key => key === 'write')
    await h.run()
    expect(h.events.some(e => e.startsWith('select'))).toBe(false)
    expect(h.events).toContain(`child got ${ALLOW_OPTION}`)
    expect(h.child().received.find(m => m.type === 'extension_ui_response')).toMatchObject({ value: ALLOW_OPTION })
  })
})

/** 只跑一段子进程剧本，收集主会话记下的条目 */
function runScript(script: (child: FakeChild) => Promise<void>) {
  let tool: { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }> }> } | null = null
  const entries: Json[] = []
  createSubagentExtension({ mode: () => 'default', spawnChild: () => new FakeChild(script) as never })({
    registerTool: (t: never) => (tool = t),
    getThinkingLevel: () => 'off',
    appendEntry: (_type: string, data: Json) => entries.push(data),
  } as never)
  const ctx = { cwd: process.cwd(), mode: 'rpc', model: undefined, sessionManager: { getSessionFile: () => undefined } }
  const run = () => tool!.execute('t1', { description: '查东西', prompt: 'look' }, undefined, undefined, ctx)
  return { run, entries }
}

const AUTH_ERROR = '401 Unauthorized: REVIEW_AUTH_FAILURE'
const assistant = (message: Json) => ({
  type: 'message_end',
  message: { role: 'assistant', content: [], usage: { input: 1, output: 1 }, ...message },
})

describe('子智能体：模型请求失败', () => {
  it('最后一条回复是 stopReason error：工具报错带上原因，记下的状态是 failed', async () => {
    const h = runScript(async c => c.send(assistant({ stopReason: 'error', errorMessage: AUTH_ERROR })))
    await expect(h.run()).rejects.toThrow(`Subagent failed: ${AUTH_ERROR}`)
    expect(h.entries).toEqual([expect.objectContaining({ state: 'failed', result: AUTH_ERROR, toolCallId: 't1' })])
  })

  it('已经写出一部分再出错：原因在前，已有的回复跟在后面', async () => {
    const h = runScript(async c => {
      c.send(assistant({ content: [{ type: 'text', text: 'found a.ts' }], stopReason: 'toolUse' }))
      c.send(assistant({ stopReason: 'error', errorMessage: AUTH_ERROR }))
    })
    await expect(h.run()).rejects.toThrow(`Subagent failed: ${AUTH_ERROR}\n\nPartial report:\nfound a.ts`)
    expect(h.entries[0]).toMatchObject({ state: 'failed' })
  })

  it('出错后 Pi 自动重试成功：按最后一条算，正常完成', async () => {
    const h = runScript(async c => {
      c.send(assistant({ stopReason: 'error', errorMessage: '529 overloaded' }))
      c.send(assistant({ content: [{ type: 'text', text: 'all good' }], stopReason: 'stop' }))
    })
    const result = await h.run()
    expect(result.content[0].text).toBe('all good')
    expect(h.entries[0]).toMatchObject({ state: 'completed', result: 'all good' })
  })

  it('没有 errorMessage 也算失败', async () => {
    const h = runScript(async c => c.send(assistant({ stopReason: 'error' })))
    await expect(h.run()).rejects.toThrow('Subagent failed: Model request failed')
  })
})
