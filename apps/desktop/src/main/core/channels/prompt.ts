// 协作频道派活的提示词和结果摘取（docs/ui/channels-phase-b.md §4.2、§5.2）。纯函数，不碰磁盘和引擎。
import type { Locale } from '../../../shared/i18n/messages'
import type { ChannelMessage, ChannelTaskStatus } from '../../../shared/types/channels'
import { excerpt, splitMentions, type Mentionable } from '../../../shared/channels/mentions'

/** 最近的讨论最多带这么多条 / 这么多字，先到哪个停在哪个 */
export const HISTORY_MESSAGES = 20
/** 会话有频道工具（channel_read 能往前翻）时只带这么多条（docs/ui/channels-collab-v2.md §1） */
export const HISTORY_WITH_TOOLS = 5
export const HISTORY_CHARS = 8000
/** 任务卡标题、摘要的长度上限 */
export const TITLE_MAX = 60
export const SUMMARY_MAX = 140
/** 发回频道的回复最多存这么多字 */
export const RESULT_MAX = 20_000
/** 历史里一条真人消息最多带这么多字 */
const LINE_MAX = 1000

const en = (locale: Locale): boolean => locale === 'en-US'

const STATUS: Record<ChannelTaskStatus, [string, string]> = {
  queued: ['排队中', 'queued'],
  approval: ['等待同意', 'awaiting approval'],
  running: ['进行中', 'in progress'],
  waiting: ['等你确认', 'waiting for approval'],
  done: ['已完成', 'done'],
  failed: ['失败', 'failed'],
  stopped: ['已停止', 'stopped'],
}

/** 消息正文 → 任务卡标题：去掉 @成员 和 @全体，取第一行非空文字 */
export function taskTitle(text: string, members: readonly Mentionable[]): string {
  const plain = splitMentions(text, members)
    .filter(s => !s.memberId && !s.all)
    .map(s => s.text)
    .join('')
  const line =
    plain
      .split('\n')
      .map(l =>
        l
          .replace(/\s+/g, ' ')
          .replace(/^[\s,，:：、]+/, '')
          .trim(),
      )
      .find(Boolean) ?? ''
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line
}

/** 云端生成的团队任务卡标题只去掉了被派活的成员名，@全体 还在：去掉它，其余照旧 */
export function titleWithoutAll(title: string, members: readonly Mentionable[]): string {
  const segments = splitMentions(title, members)
  if (!segments.some(s => s.all)) return title
  const plain = segments
    .filter(s => !s.all)
    .map(s => s.text)
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，:：、]+/, '')
    .trim()
  return plain || title
}

const DECISION = /^\s*(?:[-*>]\s*)?(?:\*\*)?(?:需要你决定|Needs your decision)\s*[:：]\s*(?:\*\*)?\s*(.+?)\s*$/im

/** 回复里「需要你决定：」那一行的内容；没有时 null */
export function decisionOf(text: string): string | null {
  const m = DECISION.exec(text)
  return m ? m[1].replace(/\*\*$/, '').trim() || null : null
}

/** 回复的第一段（不含「需要你决定」那一行），压成一行，最多 140 字 */
export function summaryOf(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p =>
      p
        .split('\n')
        .filter(line => !DECISION.test(line))
        .join(' ')
        .replace(/^#+\s*/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
  return excerpt(paragraphs[0] ?? '', SUMMARY_MAX)
}

/** 回复太长时截断，末尾注明去会话里看 */
export function clipResult(text: string, locale: Locale): string {
  if (text.length <= RESULT_MAX) return text
  return `${text.slice(0, RESULT_MAX)}\n\n${en(locale) ? '…full reply in the session' : '…完整内容见会话'}`
}

/** 消息带了附件：「（附 2 张图片、1 个文件）」；都没有时空串 */
export function attachedNote(images: number, files: number, locale: Locale): string {
  if (!images && !files) return ''
  if (en(locale)) {
    const parts = [
      images ? `${images} image${images > 1 ? 's' : ''}` : '',
      files ? `${files} file${files > 1 ? 's' : ''}` : '',
    ]
    return `(attached: ${parts.filter(Boolean).join(', ')})`
  }
  const parts = [images ? `${images} 张图片` : '', files ? `${files} 个文件` : '']
  return `（附 ${parts.filter(Boolean).join('、')}）`
}

/** 几条消息的附件合在一起超过上限、这一轮没带上的；都带上了时空串 */
export function droppedNote(images: number, files: number, locale: Locale): string {
  if (!images && !files) return ''
  if (en(locale)) {
    const parts = [
      images ? `${images} image${images > 1 ? 's' : ''}` : '',
      files ? `${files} file${files > 1 ? 's' : ''}` : '',
    ]
    return `(${parts.filter(Boolean).join(' and ')} from the channel could not be attached: over the per-message limit)`
  }
  const parts = [images ? `${images} 张图片` : '', files ? `${files} 个文件` : '']
  return `（频道里还有 ${parts.filter(Boolean).join('、')} 超过一条消息的上限，这次没带上）`
}

/** 历史里的一行；事件和只在讨论串里的消息不带（null） */
export function historyLine(m: ChannelMessage, nameOf: (id: string) => string, locale: Locale): string | null {
  const colon = en(locale) ? ': ' : '：'
  if (m.kind === 'event' || (m.kind === 'message' && m.threadId)) return null
  if (m.kind === 'task') {
    const status = STATUS[m.status][en(locale) ? 1 : 0]
    return en(locale)
      ? `${nameOf(m.authorId)} handed to ${nameOf(m.assigneeId)}: ${m.title} (${status})`
      : `${nameOf(m.authorId)} 交给 ${nameOf(m.assigneeId)}：${m.title}（${status}）`
  }
  // AI 的长回复只带第一段
  const body = m.format === 'markdown' ? (m.text.split(/\n\s*\n/)[0] ?? '') : m.text
  const clipped = body.trim().length > LINE_MAX ? `${body.trim().slice(0, LINE_MAX)}…` : body.trim()
  const note = m.attached ? attachedNote(m.attached.images.length, m.attached.files.length, locale) : ''
  const text = [clipped, note].filter(Boolean).join(' ')
  return text ? `${nameOf(m.authorId)}${colon}${text}` : null
}

/**
 * 派活时带上的最近讨论（从旧到新）：源消息之前的消息，从新往旧取，最多 20 条或 8000 字。
 * `since`：一直用同一个会话的成员，只补上次派活之后的；`skip`：单独列出的被引用消息不再重复。
 */
export function historyLines(
  messages: readonly ChannelMessage[],
  opts: {
    beforeId: string
    since?: number | null
    skip?: string | null
    /** 最多几条，默认 HISTORY_MESSAGES */
    limit?: number
    nameOf: (id: string) => string
    locale: Locale
  },
): string[] {
  const limit = opts.limit ?? HISTORY_MESSAGES
  const end = messages.findIndex(m => m.id === opts.beforeId)
  const earlier = end < 0 ? messages : messages.slice(0, end)
  const lines: string[] = []
  let chars = 0
  for (let i = earlier.length - 1; i >= 0 && lines.length < limit; i--) {
    const m = earlier[i]
    if (opts.since != null && m.at <= opts.since) break
    if (m.id === opts.skip) continue
    const line = historyLine(m, opts.nameOf, opts.locale)
    if (!line) continue
    if (chars + line.length > HISTORY_CHARS) break
    chars += line.length
    lines.unshift(line)
  }
  return lines
}

/** 去掉代码块和行内代码：AI 回复里代码中的 @ 不算派活 */
export function withoutCode(text: string): string {
  return text.replace(/(`{3,}|~{3,})[\s\S]*?(?:\1|$)/g, '').replace(/`[^`\n]*`/g, '')
}

/** AI 互相派活时交接的内容：谁、做完了哪项活、他的回复、改了哪些文件 */
export interface Handoff {
  from: string
  title: string
  reply: string
  files: string[]
}

/** 交接时最多列出这么多个改动的文件 */
const HANDOFF_FILES = 20

export interface DispatchInput {
  locale: Locale
  channel: { name: string; topic: string | null }
  /** 频道说明：每项活都要照着做 */
  notes?: string | null
  /** 置顶的资料（「名字：原文」） */
  pinned?: string[]
  author: string
  instructions: string
  history: string[]
  /** 被引用的消息（一定带上） */
  quoted: string | null
  request: string
  /** 这条消息带的附件数：提示词里说一句，图片和文件本身跟着这条消息一起发 */
  attached?: { images: number; files: number } | null
  /** 这条消息 @全体：同时收到这项活的其他 AI 成员 */
  together?: string[]
  /** 别的 AI 成员交过来的：交接内容（docs/ui/import-collab.md 第 5 项①） */
  handoff?: Handoff | null
  /** 频道允许 AI 成员互相派活：频道里其他 AI 成员（名字、职责第一行）；不允许时 null */
  peers?: { name: string; role: string }[] | null
  /** 会话挂了频道工具（pixelsky_channel）：说明能翻更早的讨论、在串里回复、提议派活；relay 时还能直接交接 */
  tools?: { relay: boolean } | null
}

function toolsText(tools: { relay: boolean }, locale: Locale): string {
  if (en(locale))
    return [
      "You have the channel tools (MCP server pixelsky_channel): channel_read reads earlier messages in this channel (only the last few are above), thread_read reads the discussion thread of a task card, channel_reply posts a short note in this task's thread (progress, questions; it does not interrupt anyone), and task_propose suggests giving a task to another AI member (the user decides whether to send it).",
      tools.relay
        ? 'This channel lets AI members hand work to each other: task_handover gives part of the work to another member right away. For the same handoff use either task_handover or "@name" in your final reply, not both.'
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  return [
    '你有频道工具（MCP 服务 pixelsky_channel）：channel_read 读这个频道更早的消息（上面只带了最近几条），thread_read 读某张任务卡的讨论串，channel_reply 在这项活的串里写一句（进展、问题，不会打断别人），task_propose 提议把一项活交给别的 AI 成员（由用户决定派不派）。',
    tools.relay
      ? '这个频道允许 AI 成员互相派活：task_handover 可以直接把一部分活交给别的成员。同一次交接用 task_handover 或在最后的回复里写「@名字」二选一，不要两样都用。'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function handoffText(h: Handoff, locale: Locale): string {
  const files = h.files.slice(0, HANDOFF_FILES)
  const more = h.files.length - files.length
  // 用频道工具 task_handover 做到一半交过来的：没有回复，要求里写了要做什么
  const quote = h.reply.trim() ? `> ${h.reply.trim().replace(/\n/g, '\n> ')}` : ''
  if (en(locale))
    return [
      quote
        ? `${h.from} finished "${h.title}" and handed it on to you.`
        : `${h.from} is working on "${h.title}" and handed this part to you.`,
      quote ? `${h.from}'s reply:\n${quote}` : '',
      files.length ? `Files changed: ${files.join(', ')}${more > 0 ? ` and ${more} more` : ''}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  return [
    quote ? `${h.from} 做完「${h.title}」后把活交给了你。` : `${h.from} 在做「${h.title}」，把这部分交给了你。`,
    quote ? `${h.from} 的回复：\n${quote}` : '',
    files.length ? `改动的文件：${files.join('、')}${more > 0 ? ` 等 ${h.files.length} 个` : ''}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function peersText(peers: { name: string; role: string }[], locale: Locale): string {
  const list = peers.map(p => `- ${p.name}${p.role ? (en(locale) ? `: ${p.role}` : `：${p.role}`) : ''}`).join('\n')
  return en(locale)
    ? `AI members in this channel can hand work to each other: if another member should take over, write "@name" followed by what they should do in your reply, and the channel will hand it to them along with your reply and the files you changed. Only do this when it is really needed; if no handoff is needed, do not @ anyone.\nOther AI members in this channel:\n${list}`
    : `这个频道允许 AI 成员互相派活：需要别的成员接着做时，在回复里写「@名字」和要他做的事，频道会把活交给他，并带上你的回复和改动的文件。确实需要时才这样做；不用交接就不要写 @。\n频道里的其他 AI 成员：\n${list}`
}

/** 置顶资料每条、合计最多这么多字（派活提示词里，超出的截掉） */
export const PINNED_ITEM_CHARS = 1000
export const PINNED_CHARS = 4000

/** 置顶资料：多行压成一行，每条和合计都截断 */
function pinnedRefs(lines: string[]): string[] {
  const out: string[] = []
  let total = 0
  for (const line of lines) {
    const flat = line.replace(/\s*\n\s*/g, ' ').trim()
    const item = flat.length > PINNED_ITEM_CHARS ? `${flat.slice(0, PINNED_ITEM_CHARS)}…` : flat
    if (!item || total + item.length > PINNED_CHARS) break
    out.push(item)
    total += item.length
  }
  return out
}

/** 第一次派给一个会话的提示词（§4.2） */
export function dispatchPrompt(input: DispatchInput): string {
  const { locale, channel } = input
  const parts: string[] = []
  const together = input.together?.length ? input.together : null
  const pinned = pinnedRefs(input.pinned ?? [])
  if (en(locale)) {
    parts.push(
      `You have received a task in the channel #${channel.name}.${channel.topic ? ` (Channel topic: ${channel.topic})` : ''}\nHanded to you by: ${input.author}` +
        (together ? `\nThis message went to every AI member in the channel; ${together.join(', ')} got it too.` : ''),
    )
    if (input.instructions.trim()) parts.push(`Your role:\n${input.instructions.trim()}`)
    if (input.notes?.trim()) parts.push(`Channel guidelines (follow them for every task here):\n${input.notes.trim()}`)
    if (pinned.length) parts.push(`Pinned reference in this channel:\n${pinned.map(p => `- ${p}`).join('\n')}`)
    if (input.history.length) parts.push(`Recent discussion (oldest first):\n${input.history.join('\n')}`)
    if (input.quoted) parts.push(`Quoted message:\n> ${input.quoted.replace(/\n/g, '\n> ')}`)
    if (input.handoff) parts.push(handoffText(input.handoff, locale))
    parts.push(
      `The request:\n${[input.request.trim(), attachedNote(input.attached?.images ?? 0, input.attached?.files ?? 0, locale)].filter(Boolean).join('\n')}`,
    )
    if (input.peers?.length) parts.push(peersText(input.peers, locale))
    if (input.tools) parts.push(toolsText(input.tools, locale))
    parts.push(
      'When you are done, end with one or two paragraphs summarizing what you did, which files you changed and anything left unfinished.\nIf something needs a person to decide, put it on its own line starting with "Needs your decision:".',
    )
  } else {
    parts.push(
      `你在协作频道 #${channel.name} 里收到一项活。${channel.topic ? `（频道主题：${channel.topic}）` : ''}\n交给你的人：${input.author}` +
        (together ? `\n这条消息发给了频道里全体 AI 成员，${together.join('、')} 也同时收到了。` : ''),
    )
    if (input.instructions.trim()) parts.push(`你的职责：\n${input.instructions.trim()}`)
    if (input.notes?.trim()) parts.push(`频道说明（这个频道里每项活都要照着做）：\n${input.notes.trim()}`)
    if (pinned.length) parts.push(`频道里置顶的资料：\n${pinned.map(p => `- ${p}`).join('\n')}`)
    if (input.history.length) parts.push(`最近的讨论（从旧到新）：\n${input.history.join('\n')}`)
    if (input.quoted) parts.push(`引用的消息：\n> ${input.quoted.replace(/\n/g, '\n> ')}`)
    if (input.handoff) parts.push(handoffText(input.handoff, locale))
    parts.push(
      `这次的要求：\n${[input.request.trim(), attachedNote(input.attached?.images ?? 0, input.attached?.files ?? 0, locale)].filter(Boolean).join('\n')}`,
    )
    if (input.peers?.length) parts.push(peersText(input.peers, locale))
    if (input.tools) parts.push(toolsText(input.tools, locale))
    parts.push(
      '做完后，最后用一两段话总结：做了什么、改了哪些文件、有没有没做完的。\n如果有需要人来决定的事，单独写一行，以「需要你决定：」开头。',
    )
  }
  return parts.join('\n\n')
}

/** 回复任务卡 = 追加要求：会话里已经有上下文，只带原文（§7.1） */
export function followUpPrompt(input: { locale: Locale; channel: string; author: string; text: string }): string {
  return en(input.locale)
    ? `${input.text.trim()}\n\n(From #${input.channel}, ${input.author})`
    : `${input.text.trim()}\n\n（来自频道 #${input.channel}，${input.author}）`
}

/** 做到一半失败 / 停止后重试：和错误卡片的「重试」一样，发一条「继续」 */
export const continuePrompt = (locale: Locale): string => (en(locale) ? 'Try again' : '继续')

// ---------------------------------------------------------------------------
// 流程（docs/ui/channels-pipeline.md §4.4）
// ---------------------------------------------------------------------------

/** 流程概览里的一行：「② 写代码 · 程序员 · 已交付」 */
export interface FlowLine {
  no: string
  title: string
  member: string
  status: string
  /** 这一行就是收到提示词的这一步 */
  self?: boolean
}

/** 依赖步骤交上来的东西 */
export interface FlowInput {
  no: string
  title: string
  member: string
  summary: string
  files: string[]
}

export interface FlowStepPromptInput {
  locale: Locale
  channel: { name: string; topic: string | null }
  notes?: string | null
  pinned?: string[]
  instructions: string
  flow: string
  lines: FlowLine[]
  step: { no: string; title: string; kind: 'work' | 'review' | 'summary' }
  inputs: FlowInput[]
  /** 审查步骤：被审的那一步 */
  target?: FlowInput | null
  /** 流程里别的成员（member_ask 能问的） */
  peers: string[]
  /** 这一步在独立的 Git 副本里做（第 11 项）：分支、基于哪个分支（null 是主目录的当前提交） */
  copy?: { branch: string; base: string | null } | null
  /** 汇合步骤：前面的步骤各在哪个分支上，要合并进主目录 */
  merge?: { no: string; title: string; branch: string }[]
}

function inputText(i: FlowInput, locale: Locale): string {
  const files = i.files.slice(0, HANDOFF_FILES)
  const more = i.files.length - files.length
  const list = files.length
    ? en(locale)
      ? `\n  Files: ${files.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
      : `\n  文件：${files.join('、')}${more > 0 ? ` 等 ${i.files.length} 个` : ''}`
    : ''
  return en(locale)
    ? `- ${i.no} ${i.title} (${i.member}): ${i.summary}${list}`
    : `- ${i.no} ${i.title}（${i.member}）：${i.summary}${list}`
}

/** 流程里一步的提示词：流程概览、这一步要做什么、依赖交上来的东西、怎么交付 */
export function flowStepPrompt(input: FlowStepPromptInput): string {
  const { locale, channel, step } = input
  const pinned = pinnedRefs(input.pinned ?? [])
  const overview = input.lines
    .map(l => `${l.self ? '→ ' : '  '}${l.no} ${l.title} · ${l.member} · ${l.status}`)
    .join('\n')
  const peers = input.peers.length ? input.peers.join(en(locale) ? ', ' : '、') : null
  if (en(locale))
    return [
      `You are doing one step of the flow "${input.flow}" in the channel #${channel.name}.${channel.topic ? ` (Channel topic: ${channel.topic})` : ''}`,
      input.instructions.trim() ? `Your role:\n${input.instructions.trim()}` : '',
      input.notes?.trim() ? `Channel guidelines:\n${input.notes.trim()}` : '',
      pinned.length ? `Pinned reference:\n${pinned.map(p => `- ${p}`).join('\n')}` : '',
      `The flow (→ is your step):\n${overview}`,
      input.inputs.length
        ? `Delivered by earlier steps:\n${input.inputs.map(i => inputText(i, locale)).join('\n')}`
        : '',
      input.target
        ? `Review ${input.target.no} "${input.target.title}" by ${input.target.member}. Look at the actual changes with git diff / git status. When done, call task_done with verdict "pass", or "reject" plus issues (one problem per item, concrete enough to fix).`
        : '',
      step.kind === 'summary'
        ? 'This is the final step: read what every step delivered, check that the pieces fit together, and write a summary for the user (what was done, which files, anything unresolved).'
        : '',
      input.copy
        ? `You work in a separate Git copy on branch ${input.copy.branch}${input.copy.base ? ` (based on ${input.copy.base})` : ''}. Do not switch branches and do not touch the project's main folder. Before task_done, commit your changes and output files to this branch (git add -A && git commit): later steps take your work from the branch.`
        : '',
      input.merge?.length
        ? `Earlier steps worked on their own branches:\n${input.merge.map(m => `- ${m.no} ${m.title}: ${m.branch}`).join('\n')}\nFirst check with git status that this folder is clean, then git merge --no-ff each branch. Resolve conflicts yourself and explain them in the task_done summary; run the checks after merging, then call task_done.`
        : '',
      `Your step: ${step.no} ${step.title}`,
      `When you are really done, call the task_done tool (summary, files you changed); the flow moves on only after task_done. If you need something from another member${peers ? ` (${peers})` : ''}, call member_ask and then end your turn; the answer will be sent to you as a new message.`,
    ]
      .filter(Boolean)
      .join('\n\n')
  return [
    `你在协作频道 #${channel.name} 里做流程「${input.flow}」的一步。${channel.topic ? `（频道主题：${channel.topic}）` : ''}`,
    input.instructions.trim() ? `你的职责：\n${input.instructions.trim()}` : '',
    input.notes?.trim() ? `频道说明：\n${input.notes.trim()}` : '',
    pinned.length ? `频道里置顶的资料：\n${pinned.map(p => `- ${p}`).join('\n')}` : '',
    `整个流程（→ 是你这一步）：\n${overview}`,
    input.inputs.length ? `前面的步骤交上来的：\n${input.inputs.map(i => inputText(i, locale)).join('\n')}` : '',
    input.target
      ? `审查 ${input.target.no}「${input.target.title}」（${input.target.member} 做的）。用 git diff / git status 看实际改动。审完调用 task_done：verdict 写 "pass"（通过）或 "reject"（打回），打回时 issues 一条写一个问题，要具体到能照着改。`
      : '',
    step.kind === 'summary'
      ? '这是最后一步：读每一步交上来的东西，确认它们接得上，给用户写一份总结（做了什么、改了哪些文件、还有什么没解决）。'
      : '',
    input.copy
      ? `你在独立的 Git 副本里做这一步（分支 ${input.copy.branch}${input.copy.base ? `，基于 ${input.copy.base}` : ''}）。别切换分支，别动项目主目录。调用 task_done 之前把改动和产出的文件提交到这个分支（git add -A && git commit），后面的步骤按分支取你的东西。`
      : '',
    input.merge?.length
      ? `前面的步骤各在自己的分支上：\n${input.merge.map(m => `- ${m.no} ${m.title}：${m.branch}`).join('\n')}\n先用 git status 确认当前目录干净，再逐个 git merge --no-ff 这些分支；有冲突自己解决，并在 task_done 的摘要里说明；合并后跑一遍检查再调用 task_done。`
      : '',
    `你这一步：${step.no} ${step.title}`,
    `确实做完了再调用 task_done 工具交付（摘要、你改的文件）；流程只在 task_done 之后往下走。需要别的成员${peers ? `（${peers}）` : ''}提供东西时，调用 member_ask，然后结束这一轮，回答会作为新消息发给你。`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** 让成员拆流程的提示词 */
export function flowPlanPrompt(input: {
  locale: Locale
  channel: string
  request: string
  members: { name: string; role: string }[]
  /** 牵头成员按用户不带 @ 的消息自动拆的：只是问题、一步能做完时直接回答 */
  auto?: boolean
}): string {
  const sep = en(input.locale) ? ': ' : '：'
  const list = input.members.map(m => `- ${m.name}${m.role ? `${sep}${m.role}` : ''}`).join('\n')
  if (en(input.locale))
    return [
      `In the channel #${input.channel}, the user wants this done by several AI members as a flow:\n${input.request}`,
      `Members you can use:\n${list}`,
      'Split it into at most 9 steps. Each step: title (what to do), member (exact name), deps (numbers of the steps that must be delivered first, counting from 1), kind ("work"; "review" with target = the step number it reviews; or "summary" for the final wrap-up). Steps that do not depend on each other run in parallel. Do not do the work yourself.',
      'When the split is ready, call task_done with summary (one line) and steps. The user will check it and start it.',
      input.auto
        ? 'You are the lead of this channel and the user did not name anyone. If this is just a question, or one member can finish it in one go, do not call task_done: answer directly in your reply.'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  return [
    `用户想在频道 #${input.channel} 里让几个 AI 成员按流程做这件事：\n${input.request}`,
    `能用的成员：\n${list}`,
    '把它拆成最多 9 步。每一步写：title（做什么）、member（成员名字，原样写）、deps（要先交付的步骤序号，从 1 数）、kind（"work" 干活；"review" 审查，target 写审第几步；"summary" 最后汇总）。互相不依赖的步骤会同时做。不要自己动手做这件事。',
    '拆好后调用 task_done：summary 写一句话，steps 写上面的步骤。用户确认后才会开始。',
    input.auto
      ? '你是这个频道的牵头成员，用户没有点名交给谁。如果这只是个问题，或者一个成员一次就能做完，不要调用 task_done，直接在回复里回答。'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const quote = (text: string): string => `> ${text.trim().replace(/\n/g, '\n> ')}`

/** 别的成员问过来的问题（发给被问的成员） */
export function flowAskPrompt(locale: Locale, from: string, question: string): string {
  return en(locale)
    ? `${from} (another member of the flow) asks you:\n${quote(question)}\n\nAnswer in your reply; the answer will be passed to ${from}. Do not call task_done for this: answering does not change your own delivery.`
    : `${from}（流程里的另一个成员）问你：\n${quote(question)}\n\n直接在回复里回答，回答会转给 ${from}。这次不用调用 task_done，回答不改你自己的交付。`
}

/** 被问的成员的回答（发回给提问的人） */
export function flowAnswerPrompt(locale: Locale, from: string, answer: string): string {
  return en(locale)
    ? `${from}'s answer:\n${quote(answer)}\n\nContinue your step; call task_done when it is really done.`
    : `${from} 的回答：\n${quote(answer)}\n\n接着做你这一步，确实做完了再调用 task_done。`
}

/** 一轮做完了却没交付：提醒一次 */
export function flowRemindPrompt(locale: Locale): string {
  return en(locale)
    ? 'Your turn ended without task_done, so the flow is still waiting on this step. If it is done, call task_done now (summary, files). If not, keep going, or say exactly what is missing.'
    : '你这一轮结束了，但还没有调用 task_done，流程还在等这一步。做完了就现在调用 task_done（摘要、文件）；没做完就接着做，或者写清楚还差什么。'
}

/** 被审查打回：问题清单 */
export function flowRejectPrompt(
  locale: Locale,
  reviewer: string,
  issues: string[],
  round: number,
  max: number,
): string {
  const list = issues.map((x, i) => `${i + 1}. ${x}`).join('\n')
  return en(locale)
    ? `${reviewer} reviewed your step and sent it back (${round}/${max}):\n${list}\n\nFix these, then call task_done again.`
    : `${reviewer} 审查了你这一步，打回了（第 ${round} / ${max} 次）：\n${list}\n\n改好后再调用 task_done。`
}

/** 被审的那一步改完了：再审一次 */
export function flowReviewAgainPrompt(locale: Locale, target: FlowInput): string {
  return en(locale)
    ? `${target.no} "${target.title}" was changed after your review:\n${inputText(target, locale)}\n\nReview it again and call task_done with the verdict.`
    : `${target.no}「${target.title}」按你的意见改过了：\n${inputText(target, locale)}\n\n再审一次，审完调用 task_done 给出结论。`
}

/** 等的回答一直没来，你点了继续：自己判断 */
export function flowNoAnswerPrompt(locale: Locale): string {
  return en(locale)
    ? 'The answer you asked for did not come. Decide on your own, continue your step and call task_done when it is really done; note what you assumed.'
    : '你问的问题一直没等到回答。自己判断后接着做这一步，确实做完了再调用 task_done，并写明你做了什么假设。'
}

/** 人工关卡打回（第 12 项）：用户看了交付，要改的地方 */
export function flowGatePrompt(locale: Locale, note: string): string {
  return en(locale)
    ? `The user looked at what you delivered and wants changes:\n${quote(note)}\n\nMake the changes, then call task_done again.`
    : `用户看了你这一步交上来的东西，要你改：\n${quote(note)}\n\n改好后再调用 task_done。`
}
