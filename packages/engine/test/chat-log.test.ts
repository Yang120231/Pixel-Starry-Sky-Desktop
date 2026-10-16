import { describe, expect, it } from 'vitest'
import type { ImageAttachment, Item } from '@pixelsky/protocol'
import {
  HANDOFF_IMAGE_BYTES,
  buildChatLog,
  buildChatSeed,
  chatOverview,
  fitChatLog,
  handoffImageRoom,
  pickRecentImages,
  renderSeed,
  seedImageCount,
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

const MB = 1024 * 1024
const image = (name: string, bytes = 1000): ImageAttachment => ({
  id: name,
  name,
  mediaType: 'image/png',
  bytes,
  width: 1,
  height: 1,
  dataBase64: `data-${name}`,
})
const names = (images: readonly ImageAttachment[] | undefined) => (images ?? []).map(i => i.name)

describe('交接带图片', () => {
  it('每轮收集用户消息的图片（含中途补充），用户话里照写文件名', () => {
    const a = image('a.png'),
      b = image('b.png')
    const out = buildChatLog([
      user('看这个', { attachments: [a] }),
      user('再看这个', { mode: 'guidance', attachments: [b] }),
      assistant('看了'),
      user('没有图'),
    ])
    expect(out[0].images).toEqual([a, b])
    expect(out[0].user).toBe('看这个（附：a.png）\n（中途补充）再看这个（附：b.png）')
    expect(out[1]).not.toHaveProperty('images')
  })

  it('指定 carried 时没在里面的图片不进 images，用户话里写明未带上', () => {
    const a = image('a.png'),
      b = image('b.png')
    const file = { id: 'f', name: 'x.ts', bytes: 0, lines: 0, encoding: 'utf-8', text: '', tail: '' }
    const out = buildChatLog(
      [user('看', { attachments: [a, b], files: [file] as Extract<Item, { kind: 'user' }>['files'] })],
      { carried: new Set([b]) },
    )
    expect(out[0].images).toEqual([b])
    expect(out[0].user).toBe('看（附：b.png、x.ts）（附图 a.png，未带上）')
    // 一张都没带：没有 images
    const none = buildChatLog([user('看', { attachments: [a] })], { carried: new Set() })
    expect(none[0]).not.toHaveProperty('images')
    expect(none[0].user).toBe('看（附图 a.png，未带上）')
  })

  it('只带最近的 5 张，更早的写明未带上，并记下没带上的张数', () => {
    const imgs = Array.from({ length: 7 }, (_, i) => image(`${i}.png`))
    const items = imgs.flatMap((img, i) => [user(`问${i}`, { attachments: [img] }), assistant(`答${i}`)])
    const seed = buildChatSeed(items, '材料')!
    expect(seed.turns.map(t => names(t.images))).toEqual([
      [],
      [],
      ['2.png'],
      ['3.png'],
      ['4.png'],
      ['5.png'],
      ['6.png'],
    ])
    expect(seed.turns[0].user).toBe('问0（附图 0.png，未带上）')
    expect(seed.turns[2].user).toBe('问2（附：2.png）')
    expect(seed.omittedImages).toBe(2)
    expect(seedImageCount(seed)).toBe(5)
    expect(renderSeed(seed)).toContain('用户：问0（附图 0.png，未带上）\n助手：答0')
  })

  it('总大小不超过上限：从最新往前装，遇到装不下的就停', () => {
    const items = [
      user('一', { attachments: [image('small.png', 1 * MB)] }),
      user('二', { attachments: [image('big.png', 4 * MB)] }),
      user('三', { attachments: [image('new.png', 2 * MB)] }),
    ]
    const seed = buildChatSeed(items, '')!
    // new 2MB + big 4MB 超过 5MB：big 装不下，更早的 small 也不再带
    expect(seed.turns.map(t => names(t.images))).toEqual([[], [], ['new.png']])
    expect(seed.omittedImages).toBe(2)
    expect(HANDOFF_IMAGE_BYTES).toBe(5 * MB)
  })

  it('折进概要的更早几轮不带图', () => {
    const items = [
      user('更早的一轮'.repeat(10), { attachments: [image('old.png')] }),
      assistant('答'.repeat(100)),
      user('最近', { attachments: [image('new.png')] }),
      assistant('好'),
    ]
    const seed = buildChatSeed(items, '', 50)!
    expect(seed.overview).toContain('更早')
    expect(seed.turns.map(t => names(t.images))).toEqual([['new.png']])
    expect(seed.omittedImages).toBe(1)
  })

  it('目标引擎不能看图：一张都不带', () => {
    const seed = buildChatSeed([user('看', { attachments: [image('a.png')] })], '', undefined, { carryImages: false })!
    expect(seed.turns[0]).not.toHaveProperty('images')
    expect(seed.turns[0].user).toBe('看（附图 a.png，未带上）')
    expect(seed.omittedImages).toBe(1)
  })

  it('没有图时回放里没有图片相关的字段；退回文字交接带的图片原样记在 fallbackImages', () => {
    expect(buildChatSeed([user('问')], '材料')).not.toHaveProperty('omittedImages')
    const a = image('a.png')
    const seed = buildChatSeed([user('问', { attachments: [a] })], '材料', undefined, { fallbackImages: [a] })!
    expect(seed.fallbackImages).toEqual([a])
  })

  it('概要接在第一轮前面时图片跟着第一轮', () => {
    const a = image('a.png')
    const turns = seedTurns({
      overview: '概要',
      turns: [{ id: 'a', user: '问', assistant: '答', images: [a] }],
      fallback: '',
    })
    expect(turns).toEqual([{ id: 'a', user: '概要\n\n问', assistant: '答', images: [a] }])
  })

  it('回放按传入的额度挑图：当前消息自己的图片占了额度时少带', () => {
    const items = [user('一', { attachments: [image('a.png', 1000), image('b.png', 1000)] }), assistant('好')]
    const seed = buildChatSeed(items, '', undefined, { room: handoffImageRoom([1, 2, 3, 4].map(i => image(`c${i}`))) })!
    expect(names(seed.turns[0].images)).toEqual(['b.png'])
    expect(seed.omittedImages).toBe(1)
    // 大小也一样：只剩 500 字节的额度，一张都装不下
    const none = buildChatSeed(items, '', undefined, { room: { count: 5, bytes: 500 } })!
    expect(none.turns[0]).not.toHaveProperty('images')
    expect(none.omittedImages).toBe(2)
  })

  it('额度：当前消息自己的图片先占掉数量和大小', () => {
    expect(handoffImageRoom()).toEqual({ count: 5, bytes: 5 * MB })
    expect(handoffImageRoom([image('a', 1 * MB), image('b', 1 * MB)])).toEqual({ count: 3, bytes: 5 * MB })
    // 总量上限 20 MiB：当前消息已经 18 MiB，只剩 2 MiB
    expect(handoffImageRoom([image('a', 9 * MB), image('b', 9 * MB)])).toEqual({ count: 3, bytes: 2 * MB })
    expect(handoffImageRoom(Array.from({ length: 5 }, (_, i) => image(String(i))))).toEqual({
      count: 0,
      bytes: 5 * MB,
    })
    expect(pickRecentImages([image('a', 2), image('b', 2)], { count: 5, bytes: 3 }).map(i => i.name)).toEqual(['b'])
    expect(pickRecentImages([image('a')], { count: 0, bytes: 5 * MB })).toEqual([])
  })
})
