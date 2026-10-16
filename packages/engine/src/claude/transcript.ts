// Claude Code 自己的会话记录文件：<CLAUDE_CONFIG_DIR 或 ~/.claude>/projects/<编码后的工作目录>/<session_id>.jsonl
// 编码规则：工作目录里不是字母数字的字符都换成 '-'（例如 D:\像素星空 → D------）。
// 很长的路径会被截断并加哈希，所以按规则找不到时，再在所有项目目录里找一遍。
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ImageAttachment } from '@pixelsky/protocol'
import { isFile } from '../exec'

export function defaultProjectsDir(env: NodeJS.ProcessEnv): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
}

export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/** 找 Claude Code 的会话记录文件（<会话 id>.jsonl）；找不到返回 null */
export function findClaudeTranscript(projectsDir: string, cwd: string, sessionId: string): string | null {
  const direct = join(projectsDir, encodeCwd(cwd), `${sessionId}.jsonl`)
  if (isFile(direct)) return direct
  try {
    for (const d of readdirSync(projectsDir, { withFileTypes: true })) {
      const p = join(projectsDir, d.name, `${sessionId}.jsonl`)
      if (d.isDirectory() && isFile(p)) return p
    }
  } catch {
    // 目录不存在
  }
  return null
}

/** Claude Code 那边是否还留着这个会话的记录（决定用 --resume 还是 --session-id） */
export function claudeTranscriptExists(projectsDir: string, cwd: string, sessionId: string): boolean {
  return findClaudeTranscript(projectsDir, cwd, sessionId) !== null
}

/** Claude Code 放这个会话附属文件（子智能体对话、编排结果）的目录：记录文件去掉 .jsonl */
export function claudeSessionDir(projectsDir: string, cwd: string, sessionId: string): string | null {
  const file = findClaudeTranscript(projectsDir, cwd, sessionId)
  return file ? file.slice(0, -'.jsonl'.length) : null
}

/** 从记录末尾往前找第一条让 pick 返回值的条目；记录很大时也只读最后一段 */
function scanBack<T>(file: string, pick: (entry: Record<string, unknown>) => T | null): T | null {
  const size = statSync(file).size
  for (let chunk = 256 * 1024; ; chunk *= 4) {
    const start = Math.max(0, size - chunk)
    const buffer = Buffer.alloc(size - start)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buffer, 0, buffer.length, start)
    } finally {
      closeSync(fd)
    }
    const lines = buffer.toString('utf8').split('\n')
    // 不是从文件开头读的：第一行多半是半截
    if (start > 0) lines.shift()
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue
      try {
        const found = pick(JSON.parse(lines[i]) as Record<string, unknown>)
        if (found !== null) return found
      } catch {
        // 跳过写坏的行
      }
    }
    if (start === 0) return null
  }
}

/** 当前分支的最后一条消息：主线上（不是子智能体）最后写进记录的 user / assistant 条目的 uuid，没有时 null */
export function currentLeaf(file: string): string | null {
  return scanBack(file, e =>
    (e.type === 'user' || e.type === 'assistant') && typeof e.uuid === 'string' && e.isSidechain !== true
      ? e.uuid
      : null,
  )
}

/**
 * 让另起的 --resume 进程读当前分支（GitHub #82）。Claude Code 恢复会话时，最后一条 last-prompt 记的 leafUuid
 * 还是分支末端就从它接着读；这条只在会话进程退出时写。回退时进程退出，记下的是回退前那条分支的末端，
 * 之后接着聊（进程还开着）的新分支就被它盖住：恢复代码的辅助进程、旁聊读到旧分支，新消息找不到检查点。
 * 记的不是当前末端时，按 Claude Code 自己的格式补一条指向当前末端的 last-prompt（--resume-session-at 换不了分支，
 * 只能在它读到的那条分支里截断）。会话进程之后退出时会照常再写一条，和这条一致
 */
export function pointLastPrompt(file: string, sessionId: string): void {
  const leaf = currentLeaf(file)
  if (!leaf) return
  const last = scanBack(file, e => (e.type === 'last-prompt' ? e : null))
  if (last?.leafUuid === leaf) return
  const lastPrompt = typeof last?.lastPrompt === 'string' ? last.lastPrompt : ''
  appendFileSync(file, JSON.stringify({ type: 'last-prompt', lastPrompt, leafUuid: leaf, sessionId }) + '\n')
}

/**
 * 回退截断点：按顺序找第一条出现在记录里的用户消息（我们发送时把条目 id 写成了 uuid，接力写进去的用 seedUuid），
 * 取它的 parentUuid 作为 --resume-session-at。都不在记录里时返回 null。
 * 同一个 uuid 出现多次时以第一次为准（后面的是重复写入，它的 parentUuid 不可信）
 */
export function findRewindAnchor(file: string, userIds: string[]): { at: string | null } | null {
  const parents = new Map<string, string | null>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { type?: unknown; uuid?: unknown; parentUuid?: unknown; isSidechain?: unknown }
      if (e.type === 'user' && typeof e.uuid === 'string' && e.isSidechain !== true && !parents.has(e.uuid))
        parents.set(e.uuid, typeof e.parentUuid === 'string' ? e.parentUuid : null)
    } catch {
      // 跳过写坏的行
    }
  }
  for (const id of userIds) {
    // Claude 自己收到的消息是条目 id 原样，接力写进去的是 seedUuid
    const uuid = parents.has(id) ? id : seedUuid(id)
    if (parents.has(uuid)) return { at: parents.get(uuid) ?? null }
  }
  return null
}

/**
 * 截断点在记录里的位置。Claude Code 恢复会话时只加载最近一次压缩之后的部分，更早的条目
 * 用 --resume-session-at 找不到（报 No message found…，docs/ui/rewind-fork-sidechat.md §2.4）。
 * 'loaded'：在最近一次压缩之后；'compacted'：在它之前；null：记录里没有。
 */
export function anchorPosition(file: string, at: string): 'loaded' | 'compacted' | null {
  let index = -1
  let boundary = -1
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return
      try {
        const e = JSON.parse(line) as { type?: unknown; subtype?: unknown; uuid?: unknown; isSidechain?: unknown }
        if (e.uuid === at && index < 0) index = i
        if (e.type === 'system' && e.subtype === 'compact_boundary' && e.isSidechain !== true) boundary = i
      } catch {
        // 跳过写坏的行
      }
    })
  if (index < 0) return null
  return index > boundary ? 'loaded' : 'compacted'
}

/**
 * 把记录复制到截断点为止（含截断点），存成同目录下 <sessionId>.jsonl，返回新文件路径；截断点不在记录里时返回 null。
 * 截断点是最后一条，Claude Code 用 --resume 加载时从它往回接，之前的压缩摘要照常生效（§2.4）。
 */
export function copyTranscriptUntil(file: string, at: string, sessionId: string): string | null {
  const out: string[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e: Record<string, unknown>
    try {
      e = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof e.sessionId === 'string') e.sessionId = sessionId
    out.push(JSON.stringify(e))
    if (e.uuid === at) {
      const path = join(dirname(file), `${sessionId}.jsonl`)
      writeFileSync(path, out.join('\n') + '\n', { flag: 'wx' })
      return path
    }
  }
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 接力写进记录的用户消息 uuid：条目 id 本身是 UUID 就用它；不是（例如重试的消息 id 带后缀）就按 id 算一个固定的
 * UUID（v5 格式），同一条消息每次都得到同一个，回退时照样找得到截断点
 */
export function seedUuid(id: string): string {
  if (UUID.test(id)) return id
  const h = createHash('sha1').update(`pixelsky:${id}`).digest('hex')
  const variant = ((parseInt(h[16], 16) & 3) | 8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * 读整份记录：当前分支末端（同 currentLeaf）、从末端往回整条分支上的 uuid、记录里出现过的全部 uuid。
 * 压缩分界的 parentUuid 是 null，顺着 logicalParentUuid 接回压缩之前；遇到环就停
 */
function readBranch(file: string): { leaf: string | null; branch: Set<string>; known: Set<string> } {
  const parents = new Map<string, string | null>()
  let leaf: string | null = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as Record<string, unknown>
      if (typeof e.uuid !== 'string' || e.isSidechain === true) continue
      const parent =
        typeof e.parentUuid === 'string'
          ? e.parentUuid
          : typeof e.logicalParentUuid === 'string'
            ? e.logicalParentUuid
            : null
      if (!parents.has(e.uuid)) parents.set(e.uuid, parent)
      if (e.type === 'user' || e.type === 'assistant') leaf = e.uuid
    } catch {
      // 跳过写坏的行
    }
  }
  const branch = new Set<string>()
  for (let id = leaf; id !== null && !branch.has(id); id = parents.get(id) ?? null) branch.add(id)
  return { leaf, branch, known: new Set(parents.keys()) }
}

/** 用户消息的 content：带图时和 Claude Code 自己记的一样，是文字块加图片块的数组；没有图就是一段文字 */
function userContent(text: string, images: readonly ImageAttachment[] = []): string | Record<string, unknown>[] {
  if (images.length === 0) return text
  return [
    { type: 'text', text },
    ...images.map(image => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.dataBase64 },
    })),
  ]
}

/**
 * 跨引擎接力：把别的引擎期间的聊天按 Claude Code 自己的格式写进会话记录，之后 --resume 就带着这些轮次。
 * 没有记录时新建（从头开始），有记录时接在当前分支末端后面，再让 last-prompt 指向新的末端。
 * 用户消息的 uuid 用我们的条目 id（发送时也是这么写的；不是 UUID 时用 seedUuid），回退时照样找得到截断点。
 * 已经在当前分支上的轮次和它之前的轮次不再写：这一轮 Claude 自己收到过、只是失败了，游标没推进，重试时又交接过来；
 * 再写一遍会出现重复的 uuid，parentUuid 绕成环。返回记录文件路径
 */
export function seedTranscript(
  projectsDir: string,
  cwd: string,
  sessionId: string,
  turns: readonly { id: string; user: string; assistant: string | null; images?: readonly ImageAttachment[] }[],
  noReply: string,
): string {
  const existing = findClaudeTranscript(projectsDir, cwd, sessionId)
  const file = existing ?? join(projectsDir, encodeCwd(cwd), `${sessionId}.jsonl`)
  const { leaf, branch, known } = existing
    ? readBranch(existing)
    : { leaf: null, branch: new Set<string>(), known: new Set<string>() }
  let parent = leaf
  const timestamp = new Date().toISOString()
  const base = { isSidechain: false, userType: 'external', cwd, sessionId, timestamp }
  const lines: string[] = []
  // Claude 自己收到的消息 uuid 是发送时的条目 id 原样（重试的不是 UUID），接力写进去的是 seedUuid
  const from = turns.findLastIndex(turn => branch.has(turn.id) || branch.has(seedUuid(turn.id))) + 1
  for (const turn of turns.slice(from)) {
    const id = seedUuid(turn.id)
    // 记录里别的分支上已经有这个 uuid：换一个，不能重复
    const userId = known.has(id) ? randomUUID() : id
    lines.push(
      JSON.stringify({
        ...base,
        parentUuid: parent,
        type: 'user',
        uuid: userId,
        message: { role: 'user', content: userContent(turn.user, turn.images) },
      }),
    )
    const replyId = randomUUID()
    lines.push(
      JSON.stringify({
        ...base,
        parentUuid: userId,
        type: 'assistant',
        uuid: replyId,
        message: { role: 'assistant', type: 'message', content: [{ type: 'text', text: turn.assistant ?? noReply }] },
      }),
    )
    parent = replyId
  }
  if (lines.length === 0) return file
  if (!existing) mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, lines.join('\n') + '\n')
  if (existing) pointLastPrompt(file, sessionId)
  return file
}
