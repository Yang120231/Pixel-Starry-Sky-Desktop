// 空界面：新用户第一次打开时的样子，没有任何项目、会话或用户数据。默认显示这一套。
import type { AppData } from './types'
import { COMPOSER } from './constants'

export const empty: AppData = {
  pinned: [],
  projects: [],
  recent: [],
  defaultSessionId: null,
  sessionDiff: null,
  toolCalls: [],
  assistantReply: null,
  changedFiles: null,
  turnUsage: null,
  attachments: [],
  composer: COMPOSER,
  composerStatus: { machine: '这台电脑', branch: null, contextPercent: null },
  defaultPanelOpen: false,
  channels: [],
  channelMembers: [],
  channelMessages: {},
  channelTeams: { teams: [], invites: [], connection: 'unavailable' },
}
