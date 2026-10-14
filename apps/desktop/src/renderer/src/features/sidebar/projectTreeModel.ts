// 侧栏项目 → 对话两层（docs/ui/sidebar-hierarchy.md）：项目方块的颜色和字、标题上的状态数、先列哪几个对话。纯函数，不依赖 window。
import { folderLabel } from '@/features/files/extraFolderPaths'
import type { Project, Session } from '@/data'
import type { SessionLane } from '@/features/board/sessionLanes'

/** 项目方块的底色：白字在亮暗两种主题下都看得清 */
export const PROJECT_COLORS = [
  '#c96442',
  '#4f7cac',
  '#5a8f6a',
  '#8a6fb0',
  '#b5803a',
  '#3f8a8a',
  '#b0577a',
  '#6b7a8f',
] as const

/** 按项目 ID 固定一个颜色（改名不变色） */
export function projectColor(id: string): string {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return PROJECT_COLORS[(hash >>> 0) % PROJECT_COLORS.length]
}

/** 方块里的字：名字里第一个字母 / 数字 / 汉字（跳过开头的 . _ - 之类），字母大写 */
export function projectInitial(name: string): string {
  const chars = Array.from(name.trim())
  const first = chars.find(c => /[\p{L}\p{N}]/u.test(c)) ?? chars[0] ?? '?'
  return first.toUpperCase()
}

/** 「等你」一类：等你批准 / 回答、出错、已暂停（新回复单独用蓝点） */
export type NeedsYouLane = 'waiting' | 'failed' | 'paused'
export const needsYou = (lane: SessionLane | undefined): lane is NeedsYouLane =>
  lane === 'waiting' || lane === 'failed' || lane === 'paused'

/** 项目标题上的汇总：在跑几个、等你几个 */
export function projectCounts(
  sessions: readonly Pick<Session, 'id' | 'status'>[],
  lanes: ReadonlyMap<string, SessionLane>,
): { running: number; waiting: number } {
  let running = 0,
    waiting = 0
  for (const s of sessions) {
    const lane = lanes.get(s.id)
    if (needsYou(lane)) waiting++
    else if (lane === 'running' || s.status === 'running') running++
  }
  return { running, waiting }
}

/** 每个项目先列这么多个对话 */
export const SHOWN_SESSIONS = 5

/**
 * 先列前 5 个；后面的里头当前打开的、在跑的、等你的、有新回复的也列出来，不会被藏进「还有 N 个」。
 * all 为 true（点了「还有 N 个」或按状态筛选时）全部列出
 */
export function visibleSessions<T extends Pick<Session, 'id' | 'status'>>(
  sessions: readonly T[],
  options: { all: boolean; selected: string | null; lanes: ReadonlyMap<string, SessionLane> },
): { shown: T[]; hidden: number } {
  if (options.all || sessions.length <= SHOWN_SESSIONS) return { shown: [...sessions], hidden: 0 }
  const shown = sessions.filter(
    (s, i) => i < SHOWN_SESSIONS || s.id === options.selected || s.status !== 'idle' || options.lanes.has(s.id),
  )
  return { shown, hidden: sessions.length - shown.length }
}

/** 多文件夹项目的每个文件夹：主文件夹在前（index 0），附加文件夹 index 从 1 起，和文件接口的「::N」对应；单文件夹项目返回空 */
export function projectFolders(
  project: Pick<Project, 'path' | 'folders'>,
): { index: number; name: string; path: string }[] {
  if (!project.folders?.length) return []
  const main = project.path ? [{ index: 0, name: folderLabel({ path: project.path }), path: project.path }] : []
  return [...main, ...project.folders.map((f, i) => ({ index: i + 1, name: folderLabel(f), path: f.path }))]
}
