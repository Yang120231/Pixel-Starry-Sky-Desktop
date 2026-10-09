import { assistantReply, changedFiles, toolCalls } from '@/data'

/** 当前会话是否有对话内容（工具调用、回复或改动）；没有时显示欢迎页 */
export const hasConversation = toolCalls.length > 0 || assistantReply !== null || changedFiles !== null
