// 提交前预览（docs/ui/feedback.md §2.3）：诊断信息的文字版、将发送的日志原文。勾选日志或换时间窗时重新取，只认最后一次请求
import { useCallback, useEffect, useState } from 'react'
import type { FeedbackPreview } from '../../../../shared/types/feedback'
import type { LogWindow } from './draft'
import { errorText, windowSince } from './logic'
import { feedbackApi } from './store'

export interface PreviewState {
  data: FeedbackPreview | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useFeedbackPreview(logsOn: boolean, range: LogWindow, around: number | null): PreviewState {
  const [data, setData] = useState<FeedbackPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    feedbackApi()
      .preview(logsOn ? { logs: { since: windowSince(range, Date.now(), around) } } : {})
      .then(
        next => {
          if (stale) return
          setData(next)
          setLoading(false)
        },
        (e: unknown) => {
          if (stale) return
          setError(errorText(e))
          setLoading(false)
        },
      )
    return () => {
      stale = true
    }
  }, [logsOn, range, around, nonce])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { data, loading, error, reload }
}
