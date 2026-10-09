// 真实 Claude Code 冒烟测试（会消耗少量额度，模型用 sonnet）：
// 检测 → 回复 → 审批写文件 → 中断 → 重启后恢复上下文
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { HostEvent, SessionRecord } from '@pixelsky/protocol'
import { EngineHost } from '../src'
import { defaultProjectsDir, encodeCwd } from '../src/claude/transcript'

const root = mkdtempSync(join(tmpdir(), 'pixelsky-smoke-'))
const projectDir = mkdtempSync(join(root, 'proj-'))
const events: HostEvent[] = []
const hosts: EngineHost[] = []

function makeHost(): EngineHost {
  const h = new EngineHost({
    dataDir: join(root, 'data'),
    emit: (e) => {
      events.push(e)
      // 调试用：SMOKE_LOG=<文件> 时把事件逐行写下来
      if (process.env.SMOKE_LOG) appendFileSync(process.env.SMOKE_LOG, JSON.stringify(e).slice(0, 600) + '\n')
    },
  })
  hosts.push(h)
  return h
}

async function waitFor<T>(pick: () => T | undefined | null | false, timeoutMs = 150_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = pick()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error('等待超时')
    await new Promise((r) => setTimeout(r, 100))
  }
}

const turns = (id: string) =>
  events.flatMap((e) => (e.kind === 'session' && e.sessionId === id && e.event.type === 'turn_completed' ? [e.event] : []))

const lastAssistant = (host: EngineHost, id: string) =>
  host
    .open(id)
    .items.filter((i) => i.kind === 'assistant')
    .map((i) => (i.kind === 'assistant' ? i.text : ''))
    .at(-1) ?? ''

afterAll(async () => {
  await Promise.all(hosts.map((h) => h.shutdown()))
  rmSync(root, { recursive: true, force: true })
  // Claude Code 给测试项目写的会话记录（~/.claude/projects/<编码后的临时目录>）也一起删掉，不在用户目录里留垃圾
  rmSync(join(defaultProjectsDir(process.env), encodeCwd(projectDir)), { recursive: true, force: true })
})

describe('真实 Claude Code', () => {
  const host = makeHost()
  let record: SessionRecord

  it('检测到 Claude Code 并且可用', async () => {
    const [claude] = await host.engines(true)
    console.log('Claude Code:', claude.status, claude.version, claude.path)
    expect(claude.status).toBe('ready')
    const project = host.addProject(projectDir)
    record = host.createSession({ projectId: project.id, model: 'sonnet', effort: 'low', permissionMode: 'ask' })
  })

  it('回复一句话', async () => {
    await host.send(record.id, '只回复 pong 这一个词，不要别的。')
    const [t] = await waitFor(() => turns(record.id).length >= 1 && turns(record.id))
    expect(t.outcome).toBe('completed')
    expect(lastAssistant(host, record.id).toLowerCase()).toContain('pong')
    expect(host.open(record.id).usage?.contextWindow).toBeGreaterThan(0)
    // 用量记录（docs/ui/usage.md）：这一轮有统计条目，写进了用量文件
    expect(t.usage).toBeTruthy()
    const stats = host.open(record.id).items.find((i) => i.kind === 'turn_stats')
    const models = stats?.kind === 'turn_stats' ? Object.values(stats.usage.models) : []
    console.log('本轮用量：', JSON.stringify(stats?.kind === 'turn_stats' ? stats.usage : null))
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].output).toBeGreaterThan(0)
    expect(models[0].requests).toBeGreaterThan(0)
    expect(host.usageSummary({ range: 'today', filter: {}, now: Date.now() }).totals.records).toBeGreaterThan(0)
  })

  it('写文件需要审批，允许后文件真的写出来', async () => {
    await host.send(record.id, '用 Write 工具在当前目录创建 hello.txt，内容是 hi（不要别的内容）。完成后只回复 done。')
    const req = await waitFor(() => host.open(record.id).pending[0])
    console.log('审批：', req.kind, req.title, JSON.stringify(req.changes))
    expect(req.kind).toBe('file_change')
    host.answer(record.id, req.requestId, { type: 'allow' })
    await waitFor(() => turns(record.id).length >= 2)
    expect(turns(record.id)[1].outcome).toBe('completed')
    expect(readFileSync(join(projectDir, 'hello.txt'), 'utf8').trim()).toBe('hi')
    expect(host.open(record.id).items.some((i) => i.kind === 'file_change' && i.status === 'completed')).toBe(true)
  })

  it('中断正在输出的回复', async () => {
    await host.send(record.id, '从 1 数到 300，每行一个数字，不要用工具。')
    await waitFor(() =>
      events.some((e) => e.kind === 'session' && e.sessionId === record.id && e.event.type === 'item_delta'),
    )
    await host.interrupt(record.id)
    await waitFor(() => turns(record.id).length >= 3)
    expect(turns(record.id)[2].outcome).toBe('interrupted')
  })

  it('重启后恢复会话，还记得之前的上下文', async () => {
    await host.shutdown()
    const again = makeHost()
    expect(again.open(record.id).items.length).toBeGreaterThan(0)
    await again.send(record.id, '我们刚才创建的文件叫什么？只回复文件名。')
    await waitFor(() => turns(record.id).length >= 4)
    expect(turns(record.id)[3].outcome).toBe('completed')
    expect(lastAssistant(again, record.id)).toContain('hello.txt')
    expect(existsSync(join(projectDir, 'hello.txt'))).toBe(true)
  })

  // 下面三项用一个新会话（完全独立于上面的上下文）
  let s2: SessionRecord

  it('子智能体：子智能体条、追踪数据、子智能体的会话能读出来', async () => {
    const h = hosts.at(-1)!
    s2 = h.createSession({ projectId: record.projectId, model: 'sonnet', effort: 'low', permissionMode: 'edits' })
    await h.send(s2.id, '用 Agent 工具派一个 general-purpose 子智能体，description 写「看目录」，让它用 Glob 列出当前目录的文件并汇报。你自己不要用其他工具，最后只回复 done。')
    // 子智能体调用工具也可能要审批（审批卡片照常出现）：测试里一律允许
    await waitFor(() => {
      for (const p of h.open(s2.id).pending) h.answer(s2.id, p.requestId, { type: 'allow' })
      return turns(s2.id).length >= 1
    })
    const snap = h.open(s2.id)
    console.log('subagents', JSON.stringify(snap.subagents))
    console.log('runs.agents', JSON.stringify(snap.runs.agents.map((a) => ({ id: a.id, label: a.label, state: a.state, tokens: a.tokens, model: a.model }))))
    console.log('sub tools', JSON.stringify(snap.items.filter((i) => 'subagent' in i && i.subagent).map((i) => [i.kind, 'name' in i ? i.name : '', 'subagent' in i ? i.subagent : ''])))
    expect(snap.subagents.length).toBeGreaterThan(0)
    expect(snap.runs.agents.length).toBeGreaterThan(0)
    const agent = snap.runs.agents[0]
    expect(agent.tokens).toBeGreaterThan(0)
    const items = await h.subagentTranscript(s2.id, agent.id)
    console.log('transcript kinds', items.map((i) => i.kind).join(','))
    expect(items.length).toBeGreaterThan(0)
    console.log('suggestion', JSON.stringify(h.open(s2.id).suggestion))
  })

  it('后台命令：出现在后台任务条，能读输出、能停止', async () => {
    const h = hosts.at(-1)!
    await h.send(s2.id, '用 shell 工具在后台（run_in_background: true）运行这个命令：ping -n 120 127.0.0.1 。启动后立刻只回复 started，不要等它结束。')
    await waitFor(() => {
      for (const p of h.open(s2.id).pending) h.answer(s2.id, p.requestId, { type: 'allow' })
      return turns(s2.id).length >= 2
    })
    await waitFor(() => h.open(s2.id).tasks.length > 0, 20_000)
    const task = h.open(s2.id).tasks[0]
    console.log('task', JSON.stringify(task))
    const out = await h.taskOutput(s2.id, task.id)
    console.log('output', JSON.stringify(out).slice(0, 200))
    await h.stopTask(s2.id, task.id)
    await waitFor(() => h.open(s2.id).tasks.length === 0, 20_000)
    const notices = h.open(s2.id).items.filter((i) => i.kind === 'notice').map((i) => (i.kind === 'notice' ? i.text : ''))
    console.log('notices', JSON.stringify(notices))
  })

  it('Fast 模式和思考摘要开关能切换（不一定能开 Fast，看账号）', async () => {
    const h = hosts.at(-1)!
    await h.update(s2.id, { thinkingSummaries: false })
    await h.update(s2.id, { fast: true })
    const snap = h.open(s2.id)
    console.log('flags', JSON.stringify(snap.flags), 'fast', snap.record.fast, 'thinking', snap.record.thinkingSummaries)
    expect(snap.record.thinkingSummaries).toBe(false)
    expect(snap.flags.fastState).not.toBeNull()
  })
})
