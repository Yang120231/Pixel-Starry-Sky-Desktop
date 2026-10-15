import type { MessageInput, QueuedMessage, QueueSettings, SendReceipt, SessionRecord } from '@pixelsky/protocol'
import { EFFORTS, ENGINES, PROVIDER_ID, validateFiles, validateImages } from '@pixelsky/protocol'

export interface QueueFile {
  items: QueuedMessage[]
  paused: boolean
  receipts: SendReceipt[]
}

export const queueSettings = (r: SessionRecord): QueueSettings => ({
  model: r.model,
  effort: r.effort,
  platform: r.platform ? { ...r.platform } : null,
  provider: r.provider ? { id: r.provider.id } : null,
  // 选了别的引擎还没生效时（运行中改的），新消息按新引擎算
  engine: r.nextEngine ?? r.engine,
})
export const sameQueueSettings = (a: QueueSettings, b: QueueSettings): boolean =>
  a.model === b.model &&
  a.effort === b.effort &&
  a.platform?.groupId === b.platform?.groupId &&
  a.platform?.account === b.platform?.account &&
  (a.provider?.id ?? null) === (b.provider?.id ?? null) &&
  // 旧排队项没有引擎：按会话当前引擎算，和任何引擎都算相同
  (a.engine ?? b.engine) === (b.engine ?? a.engine)

export function messageInput(
  input: string | MessageInput,
  record: SessionRecord,
  newId: () => string,
): MessageInput & { settings: QueueSettings } {
  const v = typeof input === 'string' ? { text: input, clientMessageId: newId() } : input
  const attachments = validateImages(v?.attachments)
  const files = validateFiles(v?.files)
  if (!v || typeof v.text !== 'string' || (!v.text.trim() && attachments.length === 0 && files.length === 0))
    throw new Error('消息不能为空')
  if (v.text.length > 1_000_000) throw new Error('消息过长，请拆分后发送')
  if (typeof v.clientMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.clientMessageId))
    throw new Error('消息 ID 无效')
  const s = v.settings ?? queueSettings(record)
  if (
    !s ||
    (s.model !== null && (typeof s.model !== 'string' || !s.model.trim())) ||
    (s.effort !== null && !EFFORTS.includes(s.effort))
  )
    throw new Error('排队消息的模型或强度无效')
  const p = s.platform
  if (
    p !== null &&
    (!p || typeof p.groupId !== 'string' || !/^\d+$/.test(p.groupId) || typeof p.account !== 'string' || !p.account)
  )
    throw new Error('排队消息的额度来源无效')
  const c = s.provider ?? null
  if (c !== null && (typeof c !== 'object' || typeof c.id !== 'string' || !PROVIDER_ID.test(c.id) || p !== null))
    throw new Error('排队消息的额度来源无效')
  if (s.engine !== undefined && !(typeof s.engine === 'string' && Object.hasOwn(ENGINES, s.engine)))
    throw new Error('排队消息的引擎无效')
  const engine = s.engine ?? record.nextEngine ?? record.engine
  return {
    text: v.text.trim(),
    clientMessageId: v.clientMessageId,
    ...(attachments.length ? { attachments } : {}),
    ...(files.length ? { files } : {}),
    settings: {
      model: s.model,
      effort: s.effort,
      platform: p ? { groupId: p.groupId, account: p.account } : null,
      provider: c ? { id: c.id } : null,
      ...(engine ? { engine } : {}),
    },
  }
}
