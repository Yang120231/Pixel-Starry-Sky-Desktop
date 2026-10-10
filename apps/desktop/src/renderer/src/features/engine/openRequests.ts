import { getMachines, machineOf, selectMachine } from '@/features/machines/store'
import { tr } from '../../i18n/core'
// 「打开这个会话」请求：别的地方（例如 设置 › 用量 明细里的按钮）发 window 事件
//   new CustomEvent('pixelsky:open-session', { detail: { sessionId } })
// 由布局（App / 分屏工作区）用这个钩子接住：会话存在就交给 open 打开（等同侧边栏点选），已删除就提示。
import { useEffect, useRef } from 'react'
import { useToast } from '@/ui'
import { projects as demoProjects } from '@/data'
import { isLive } from './hooks'
import { getEngineState } from './store'
import { navigateToItem } from '@/features/search/navigation'
import { searchTerms } from '@pixelsky/protocol'

export const OPEN_SESSION_EVENT = 'pixelsky:open-session'

function sessionExists(id: string): boolean {
  if (isLive) return getEngineState().sessions.some(s => s.record.id === id)
  return demoProjects.some(p => p.sessions.some(s => s.id === id))
}

export function useOpenSessionRequests(open: (id: string) => void): void {
  const toast = useToast()
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    const onRequest = (e: Event): void => {
      const detail = (e as CustomEvent<{ sessionId?: unknown; itemId?: unknown; query?: unknown }>).detail
      const id = detail?.sessionId
      if (typeof id !== 'string' || !id) return
      if (sessionExists(id)) {
        const show = () => {
          openRef.current(id)
          if (typeof detail?.itemId === 'string' && detail.itemId)
            navigateToItem(id, detail.itemId, typeof detail.query === 'string' ? searchTerms(detail.query) : [])
        }
        const machine = machineOf(id)
        if (getMachines().currentId !== machine)
          void selectMachine(machine)
            .then(show)
            .catch(e => toast(e.message))
        else show()
      } else toast(tr('engine.openRequests.thisConversationWasDeleted'))
    }
    window.addEventListener(OPEN_SESSION_EVENT, onRequest)
    return () => window.removeEventListener(OPEN_SESSION_EVENT, onRequest)
  }, [toast])
}
