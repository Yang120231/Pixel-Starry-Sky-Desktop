// 进行中的压缩要用到的会话状态（网关报来的进度、重试等待、中断这一轮）：条目列表是 memo 的，经 context 传给压缩那一行
import { createContext } from 'react'
import type { CompactionProgress, RequestRetryState } from '@pixelsky/protocol'

export interface CompactionLive {
  sessionId: string
  turnId: string | null
  progress: CompactionProgress | null
  retry: RequestRetryState | null
  /** 这一轮是 Claude Code 经过本机网关（平台、自定义 API），看得到细分进度 */
  gateway: boolean
}

export const CompactionLiveContext = createContext<CompactionLive | null>(null)
