// 会话视图里的回退（含代码、撤销）、分叉、旁聊（docs/ui/rewind-fork-sidechat.md §1–§3）
// 桌面版走引擎；演示模式用演示数据，只演示样子，不改任何东西
import { useEffect, useMemo, useState } from 'react'
import { ENGINES, type SessionSnapshot } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { useComingSoon } from '@/ui'
import { demo, isDemo } from '@/data/demo'
import { bridge } from '@/features/engine'
import { appendComposerDraft, removeComposerDraftTail } from '@/features/engine/drafts'
import { updateImages } from '@/features/session/attachments/drafts'
import { paneActions } from '@/features/panes/store'
import type { MessageActionsValue } from './live/MessageActions'
import type { RewindDone } from './ComposerNotices'
import type { SideAsk, SideCancel } from './sidechat/store'

interface UndoState extends RewindDone {
  /** 回退放进输入框的原文和图片：撤销时拿掉 */
  text: string
  imageIds: string[]
}

export function useBranchActions(sessionId: string | null, snapshot: SessionSnapshot | null, composerKey: string) {
  const comingSoon = useComingSoon()
  const caps = snapshot ? ENGINES[snapshot.record.engine]?.caps : undefined
  const busy =
    !!snapshot &&
    (snapshot.state !== 'idle' || snapshot.queue.some(q => ['dispatching', 'running', 'delivering'].includes(q.status)))
  const [undo, setUndo] = useState<UndoState | null>(null)
  useEffect(() => setUndo(null), [sessionId])
  // 回退后开始了新的一轮：不能撤销了
  const state = snapshot?.state
  useEffect(() => {
    if (state && state !== 'idle') setUndo(null)
  }, [state])
  const firstUserId = snapshot?.items.find(i => i.kind === 'user')?.id ?? null
  const title = snapshot?.record.title ?? ''

  const messageActions = useMemo<MessageActionsValue | null>(() => {
    if (!sessionId || (!bridge && !isDemo) || !caps?.rewind) return null
    return {
      rewindDisabledReason: busy ? tr('session.message.rewindBusy') : null,
      rewindCode: caps.rewindCode === true,
      rewindPreview: async item =>
        bridge
          ? bridge.rewindPreview(sessionId, item.id)
          : demo().conversations.rewindPreview(sessionId, item.id, firstUserId),
      rewind: async (item, options) => {
        if (!bridge) {
          // 演示：只显示撤销栏
          setUndo({ conversation: options.conversation, files: options.code ? 3 : null, text: '', imageIds: [] })
          return
        }
        const result = await bridge.rewind(sessionId, item.id, options)
        const images = result.attachments ?? []
        if (options.conversation) {
          appendComposerDraft(composerKey, result.text)
          if (images.length)
            await updateImages(composerKey, current => [
              ...current,
              ...images.filter(image => !current.some(c => c.id === image.id)),
            ]).catch(() => undefined)
        }
        setUndo(
          result.undoable
            ? {
                conversation: options.conversation,
                files: result.filesRestored ?? null,
                text: options.conversation ? result.text : '',
                imageIds: images.map(i => i.id),
              }
            : null,
        )
      },
      fork: caps.fork
        ? async item => {
            if (!bridge) {
              comingSoon(tr('fork.action'))
              return
            }
            const result = await bridge.fork(sessionId, item.id, `${title}${tr('fork.titleSuffix')}`)
            const key = result.record.id
            appendComposerDraft(key, result.text)
            if (result.attachments?.length) await updateImages(key, () => result.attachments!).catch(() => undefined)
            paneActions.open(key)
          }
        : null,
    }
  }, [sessionId, caps, busy, composerKey, firstUserId, title, comingSoon])

  const undoRewind = async (): Promise<void> => {
    if (!sessionId || !undo) return
    if (bridge) await bridge.undoRewind(sessionId)
    removeComposerDraftTail(composerKey, undo.text)
    if (undo.imageIds.length) {
      const ids = new Set(undo.imageIds)
      await updateImages(composerKey, current => current.filter(i => !ids.has(i.id))).catch(() => undefined)
    }
    setUndo(null)
  }

  const sideAsk: SideAsk = (id, question, history) =>
    bridge
      ? bridge.sideQuestion(id, question, history)
      : new Promise(resolve => setTimeout(() => resolve(demo().conversations.sideAnswer(question)), 900))
  const sideCancel: SideCancel = id => bridge?.cancelSideQuestion(id)
  const sideChat = caps?.sideChat
    ? {
        ask: sideAsk,
        cancel: sideCancel,
        disabledReason: bridge && !snapshot?.record.engineSessionId ? tr('side.needMessage') : null,
      }
    : null

  return { messageActions, undo, undoRewind, dismissUndo: () => setUndo(null), sideChat }
}
