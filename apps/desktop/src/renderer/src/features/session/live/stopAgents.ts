import { bridge } from '@/features/engine'

/** 逐个停；演示模式没有 bridge，什么也不做 */
export async function stopAgents(sessionId: string, ids: string[]): Promise<void> {
  await Promise.allSettled(ids.map(id => bridge?.stopTask(sessionId, id)))
}
