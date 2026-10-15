import { describe, expect, it } from 'vitest'
import type { Item } from '@pixelsky/protocol'
import {
  buildChatLog,
  buildChatSeed,
  chatOverview,
  fitChatLog,
  renderSeed,
  seedTurns,
  type ChatTurn,
} from '../src/chat-log'

let n = 0
const id = () => `i${++n}`
const user = (text: string, extra: Partial<Extract<Item, { kind: 'user' }>> = {}): Item => ({
  kind: 'user',
  id: `u-${text}`,
  text,
  createdAt: 0,
  ...extra,
})
const assistant = (text: string): Item => ({ kind: 'assistant', id: id(), text, status: 'completed' })
/** 只看用户话和回复，不管 id */
const chat = (turns: readonly ChatTurn[]) => turns.map(({ user, assistant }) => ({ user, assistant }))
const reasoning = (text: string): Item => ({ kind: 'reasoning', id: id(), text, status: 'completed' })
const command = (cmd: string, output: string): Item => ({
  kind: 'command',
  id: id(),
  command: cmd,
  description: null,
  output,
  exitCode: 0,
  status: 'completed',
})
const edit = (path: string): Item => ({
  kind: 'file_change',
  id: id(),
  status: 'completed',
  changes: [{ path, kind: 'update', diff: '', added: 1, removed: 0 }],
})
const todo = (text: string): Item => ({
  kind: 'todo',
  id: id(),
  status: 'completed',
  steps: [{ text, status: 'pending' }],
})

describe('buildChatLog：只带聊天', () => {
  it('每轮取用户话和这一轮最后一条助手回复', () => {
    expect(buildChatLog([user('拉取仓库'), assistant('已克隆到 F:'), user('检查文档'), assistant('看完了')])).toEqual([
      { id: 'u-拉取仓库', user: '拉取仓库', assistant: '已克隆到 F:' },
      { id: 'u-检查文档', user: '检查文档', assistant: '看完了' },
    ])
  })

  it('丢掉命令、文件改动、待办和思考', () => {
    const out = buildChatLog([
      user('拉取仓库'),
      assistant('我会把仓库克隆过去'),
      command('git clone …', 'Updating files: 100%'),
      edit('README.md'),
      reasoning('想一想'),
      todo('检查文档'),
      assistant('已克隆到 F:，工作区干净'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].assistant).toBe('已克隆到 F:，工作区干净')
    expect(JSON.stringify(out)).not.toContain('Updating files')
    expect(JSON.stringify(out)).not.toContain('README.md')
  })

  it('中途补充并进当前这轮，不另起一轮', () => {
    const out = buildChatLog([user('改一下'), user('顺便把测试补上', { mode: 'guidance' }), assistant('好了')])
    expect(out).toHaveLength(1)
    expect(out[0].user).toBe('改一下\n（中途补充）顺便把测试补上')
  })

  it('助手还没回复的轮保留用户话，assistant 为 null', () => {
    expect(chat(buildChatLog([user('在吗')]))).toEqual([{ user: '在吗', assistant: null }])
  })

  it('只带附件的用户消息用附件名表示', () => {
    const file = { id: 'f', name: 'a.ts', bytes: 0, lines: 0, encoding: 'utf-8', text: '', tail: '' }
    const out = buildChatLog([user('', { files: [file] as Extract<Item, { kind: 'user' }>['files'] })])
    expect(out[0].user).toBe('（附：a.ts）')
  })

  it('第一条用户消息之前的零散条目丢掉', () => {
    expect(chat(buildChatLog([reasoning('开场'), assistant('无主回复'), user('开始吧')]))).toEqual([
      { user: '开始吧', assistant: null },
    ])
  })

  it('超长的单条按上限截断', () => {
    const out = buildChatLog([user('啊'.repeat(50)), assistant('嗯'.repeat(50))], { userLimit: 10, assistantLimit: 10 })
    expect(out[0].user).toBe('啊啊啊啊啊啊啊啊啊啊…（已截断）')
    expect(out[0].assistant).toBe('嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯…（已截断）')
    expect(buildChatLog([user('短话')], { userLimit: 10 })[0].user).toBe('短话')
  })
})

describe('fitChatLog：装不下时留最近的原文', () => {
  const turns: ChatTurn[] = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    user: `问题${i}`,
    assistant: `回答${i}`,
  }))

  it('全部装得下时不留摘要', () => {
    const out = fitChatLog(turns, 10_000, () => '摘要')
    expect(out.overview).toBeNull()
    expect(out.turns).toEqual(turns)
  })

  it('装不下时保留最近的几轮，更早的交给摘要', () => {
    // 每轮 22 字符（问题N、回答N 各 3 字符，外加结构开销）：预算 70 装得下最近三轮，前两轮交给摘要
    const out = fitChatLog(turns, 70, earlier => `${earlier.length} 轮之前的事`)
    expect(out.turns).toEqual(turns.slice(-3))
    expect(out.overview).toBe('2 轮之前的事')
  })

  it('预算再小也至少留最近一轮', () => {
    const out = fitChatLog(turns, 1, () => '摘要')
    expect(out.turns).toEqual(turns.slice(-1))
    expect(out.overview).toBe('摘要')
  })
})

describe('交接的聊天回放', () => {
  it('更早几轮的概要只列用户的要求', () => {
    const out = chatOverview([
      { id: 'a', user: '拉取仓库', assistant: '好了' },
      { id: 'b', user: '检查  文档\n里的错字', assistant: '看完了' },
    ])
    expect(out).toBe(
      '（像素星空补充：这段对话更早还有 2 轮，原文没有带过来，下面是其中用户的要求）\n- 拉取仓库\n- 检查 文档 里的错字',
    )
    expect(chatOverview([])).toBeNull()
  })

  it('概要接在第一轮用户话前面', () => {
    const turns = seedTurns({ overview: '概要', turns: [{ id: 'a', user: '问', assistant: '答' }], fallback: '' })
    expect(turns).toEqual([{ id: 'a', user: '概要\n\n问', assistant: '答' }])
  })

  it('没有聊天时不建回放；有就带上文字交接作为兜底', () => {
    expect(buildChatSeed([command('ls', '')], '材料')).toBeNull()
    const seed = buildChatSeed([user('问'), command('ls', 'a.txt'), assistant('答')], '材料')
    expect(seed).toEqual({ overview: null, turns: [{ id: 'u-问', user: '问', assistant: '答' }], fallback: '材料' })
  })

  it('提示条目里展示注入了什么，没回复的轮写明', () => {
    const seed = buildChatSeed([user('问'), assistant('答'), user('再问')], '')!
    expect(renderSeed(seed)).toBe('用户：问\n助手：答\n\n用户：再问\n助手：（这一轮没有回复，可能被中断了）')
  })
})
