import { bridge } from '@/features/engine'

/** 逐个停，返回没停成的 id；演示模式没有 bridge，什么也不做 */
export async function stopAgents(sessionId: string, ids: string[]): Promise<string[]> {
  const done = await Promise.allSettled(ids.map(id => bridge?.stopTask(sessionId, id)))
  return ids.filter((_, i) => done[i].status === 'rejected')
}
