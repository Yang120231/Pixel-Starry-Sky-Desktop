// Claude Code 自己的会话记录文件：<CLAUDE_CONFIG_DIR 或 ~/.claude>/projects/<编码后的工作目录>/<session_id>.jsonl
// 编码规则：工作目录里不是字母数字的字符都换成 '-'（例如 D:\像素星空 → D------）。
// 很长的路径会被截断并加哈希，所以按规则找不到时，再在所有项目目录里找一遍。
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

/**
 * 回退截断点：按顺序找第一条出现在记录里的用户消息（我们发送时把条目 id 写成了 uuid），
 * 取它的 parentUuid 作为 --resume-session-at。都不在记录里时返回 null。
 */
export function findRewindAnchor(file: string, userIds: string[]): { at: string | null } | null {
  const parents = new Map<string, string | null>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { type?: unknown; uuid?: unknown; parentUuid?: unknown; isSidechain?: unknown }
      if (e.type === 'user' && typeof e.uuid === 'string' && e.isSidechain !== true) parents.set(e.uuid, typeof e.parentUuid === 'string' ? e.parentUuid : null)
    } catch {
      // 跳过写坏的行
    }
  }
  for (const id of userIds) if (parents.has(id)) return { at: parents.get(id) ?? null }
  return null
}
