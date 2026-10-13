// 折叠逻辑已迁到 @pixelsky/protocol（桌面和手机共用），这里保留旧名字的重新导出
export { foldTurns, turnReplies, splitTurns, summarizeProcess as summarize } from '@pixelsky/protocol'
export type { TurnEntry as Entry, ProcessSummary } from '@pixelsky/protocol'
