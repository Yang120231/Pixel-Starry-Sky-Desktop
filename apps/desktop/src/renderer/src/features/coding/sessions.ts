import { useMemo } from 'react'
import { useSidebarData } from '@/features/engine'
import { projectConversations, type ConversationEntry } from './sessionsModel'

/** 当前项目下的对话（置顶的在前，不含归档） */
export function useProjectConversations(projectId: string | null): ConversationEntry[] {
  const data = useSidebarData()
  return useMemo(() => projectConversations(data, projectId), [data, projectId])
}
