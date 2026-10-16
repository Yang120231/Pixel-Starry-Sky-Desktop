// 导入的对话打开 / 窗口回到前台时查一下终端里有没有又聊了新的轮次（docs/ui/claude-resume.md §4.8），有就由宿主在末尾加提示
import { useEffect } from 'react'
import { nativeSessionAction } from '@/features/engine/store'

/** 同一个对话两次检查之间至少隔这么久（窗口反复切换不会反复读记录） */
const MIN_GAP_MS = 20_000
const last = new Map<string, number>()

export function useNativeCheck(sessionId: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!sessionId || !enabled) return
    const check = (): void => {
      const now = Date.now()
      if (now - (last.get(sessionId) ?? 0) < MIN_GAP_MS) return
      last.set(sessionId, now)
      void nativeSessionAction(sessionId, 'check').catch(() => undefined)
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [sessionId, enabled])
}
