import type { SessionRecord } from '@pixelsky/protocol'
import type { DirectoryListing } from '../../../../shared/types/workspace'

/** 删「对话」时确认框补的一行：文件夹还有别的对话在用 / 没写过文件 / 有几项（列前 3 个名字） */
export type ChatDeleteNote = 'shared' | 'empty' | { count: string; names: string }

type Rec = Pick<SessionRecord, 'id' | 'cwd'>

/** listing 是 files.listExisting 对话文件夹第一层的结果（不存在时 null）；records 是界面里全部会话（含归档） */
export function chatDeleteNote(
  record: Rec,
  records: Rec[],
  listing: DirectoryListing | null,
  sep: string,
): ChatDeleteNote {
  // 分叉和原对话共用 chats/<原会话 ID>，引擎等最后一个用它的删了才动文件夹；cwd 带会话 ID，不同机器撞不上
  if (records.some(r => r.id !== record.id && r.cwd === record.cwd)) return 'shared'
  const entries = listing?.entries ?? []
  if (!entries.length) return 'empty'
  return {
    count: `${entries.length}${listing?.truncated ? '+' : ''}`,
    names:
      entries
        .slice(0, 3)
        .map(e => e.name)
        .join(sep) + (entries.length > 3 ? '…' : ''),
  }
}
