// 给会话里的正文提供文件路径链接（docs/ui/content-highlight.md §2 A、F）：用 pathLinks 判断文件是否存在，
// 点击用 openFile 在右侧工作区打开并跳到行。ui/markdown/pathLinks.tsx 只定义接口。
import { useMemo, type ReactNode } from 'react'
import { isDemo } from '@/data'
import { useToast } from '@/ui'
import { PathLinksContext, type PathLinks } from '@/ui/markdown/pathLinks'
import { openFile } from './store'
import { wholeTextFile } from './pathLinks'

export function PathLinksProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const toast = useToast()
  const value = useMemo<PathLinks | null>(() => {
    if (!sessionId || isDemo || !window.pixelsky) return null
    const ref = { sessionId }
    return {
      resolve: text => wholeTextFile(ref, text),
      open: target =>
        void openFile(ref, target.path, target.line ?? undefined, target.column ?? 1).catch((e: Error) =>
          toast(e.message),
        ),
    }
  }, [sessionId, toast])
  return <PathLinksContext.Provider value={value}>{children}</PathLinksContext.Provider>
}
