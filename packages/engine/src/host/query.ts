// 只读查询：全局搜索、产物面板。不启动引擎，不持有状态。
import { join } from 'node:path'
import type { Item, SessionRecord } from '@pixelsky/protocol'
import { artifactQuery, collectArtifacts, historyItems, recordedIn } from '../artifacts'
import { searchQuery, searchSessions } from '../search'
import type { HostContext } from './context'

export class HostQuery {
  constructor(private readonly ctx: HostContext) {}

  search(value: unknown, signal?: AbortSignal) {
    const { ctx } = this
    return searchSessions(
      {
        dataDir: ctx.store.dir,
        records: [...ctx.records.values()],
        projects: ctx.m.projects.projects(),
        liveItems: id => ctx.runtimes.get(id)?.snapshot.items,
        exists: id => ctx.records.has(id),
      },
      searchQuery(value),
      signal,
    )
  }

  artifacts(value: unknown, workspace: string, signal?: AbortSignal) {
    const { ctx } = this
    return collectArtifacts(
      {
        dataDir: ctx.store.dir,
        records: [...ctx.records.values()],
        liveItems: id => ctx.runtimes.get(id)?.snapshot.items,
      },
      artifactQuery(value, workspace),
      signal,
    )
  }

  private async artifactItems(sessionId: string): Promise<{ record: SessionRecord; items: readonly Item[] }> {
    const record = this.ctx.records.get(sessionId)
    if (!record) throw new Error('会话不存在')
    const live = this.ctx.runtimes.get(sessionId)?.snapshot.items
    return {
      record,
      items: live ?? (await historyItems(join(this.ctx.store.dir, 'sessions', sessionId, 'items.jsonl'))).items,
    }
  }

  async artifactItem(sessionId: string, itemId: string): Promise<Extract<Item, { kind: 'file_change' }> | null> {
    const { items } = await this.artifactItems(sessionId)
    const item = items.find(i => i.id === itemId)
    return item?.kind === 'file_change' ? item : null
  }

  async recordedPath(sessionId: string, absolute: string): Promise<boolean> {
    const { record, items } = await this.artifactItems(sessionId)
    return recordedIn(record, items, absolute)
  }
}
