import { isDemo } from '@/data'

/** 频道（或它的一个讨论串）输入框的草稿键；演示数据和真实数据共用草稿存储，演示模式加前缀避免混在一起 */
export const channelDraftKey = (channelId: string, threadId?: string | null): string =>
  `${isDemo ? 'demo:' : ''}channel:${channelId}${threadId ? `:thread:${threadId}` : ''}`
