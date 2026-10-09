// 空界面：新用户第一次打开时的样子，没有任何项目、会话或用户数据。默认显示这一套。
import type { AppData } from './types'
import { COMPOSER, RAIL_ITEMS } from './shared'

export const empty: AppData = {
  currentUser: null,
  railItems: RAIL_ITEMS,
  pinned: [],
  projects: [],
  recent: [],
  runStatus: null,
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
  browserPages: [],
  browserUrl: '',
  annotations: [],
  billing: {
    priceCurrency: 'CNY',
    rate: 7,
    plans: [],
    planNote: null,
    topUpOptions: [],
    customTopUp: { min: 5, max: 1000 },
    paymentMethods: [],
    topUpNote: null,
  },
  channels: [],
  channelMembers: [],
  channelMessages: {},
}
