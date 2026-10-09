// 界面数据入口。组件只从这里导入（AGENTS.md §5）。
// 默认是空界面（empty.ts）；用 `pnpm dev:demo` 启动时是演示数据（demo.ts）。
// 以后接入真实数据时，只需要替换这个文件。
import type { AppData } from './types'
import { demo } from './demo'
import { empty } from './empty'
import { tr } from '../i18n/core'

export * from './types'

/** 是否为演示模式（主进程根据环境变量 PIXELSKY_DEMO=1 传入） */
export const isDemo = window.pixelsky?.demo === true

const DATA: AppData = isDemo ? demo : empty

export const brandName = 'Pixel Starry Sky'

export const {
  currentUser,
  railItems,
  pinned,
  projects,
  recent,
  runStatus,
  defaultSessionId,
  sessionDiff,
  toolCalls,
  assistantReply,
  changedFiles,
  turnUsage,
  attachments,
  composer,
  composerStatus,
  defaultPanelOpen,
  browserPages,
  browserUrl,
  annotations,
  billing,
  channels,
  channelMembers,
  channelMessages,
} = DATA

/** 会话标题；没有选中会话时是「新会话」 */
export function sessionTitle(id: string | null): string {
  if (!id) return tr('engine.hooks.message472')
  for (const p of projects) {
    const s = [...p.sessions,...p.archived??[]].find((x) => x.id === id)
    if (s) return s.title
  }
  return recent.find((r) => r.id === id)?.title ?? pinned.find((p) => p.id === id)?.title ?? tr('engine.hooks.message472')
}
