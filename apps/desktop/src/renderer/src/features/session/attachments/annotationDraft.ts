import { useSyncExternalStore } from 'react'
import { MAX_IMAGE_COUNT, type ImageAttachment } from '@pixelsky/protocol'
import type { BrowserAnnotation } from '../../../../../shared/types/project-browser'
import { isSlashCommand, notesText } from '@/features/panel/annotationText'

/** 输入框里的网页批注附件卡：浏览器面板「发给会话」放进来，发送时合并进这条消息 */
export interface AnnotationDraft {
  /** 批注所在页面的网址 */
  url: string
  notes: BrowserAnnotation[]
  /** 批注的截图（最多 MAX_IMAGE_COUNT 张，点开可以补圈） */
  shots: ImageAttachment[]
}

// shortcut: 只放内存，重启不保留（别的附件草稿在 IndexedDB），要持久化时照 drafts.ts 的 draftStore 来
const drafts = new Map<string, AnnotationDraft>()
const listeners = new Set<() => void>()

export function setAnnotationDraft(key: string, draft: AnnotationDraft | null): void {
  if (draft) drafts.set(key, draft)
  else drafts.delete(key)
  listeners.forEach(listener => listener())
}

/** 刚被点 X 移除的卡片里的批注：浏览器面板 6 秒内可以放回列表（takeRemovedNotes 取走） */
const REMOVED_TTL = 6000
const removed = new Map<string, { notes: BrowserAnnotation[]; at: number }>()
export function removeAnnotationDraft(key: string): void {
  const draft = drafts.get(key)
  if (draft) removed.set(key, { notes: draft.notes, at: Date.now() })
  setAnnotationDraft(key, null)
}
export function takeRemovedNotes(key: string, now = Date.now()): BrowserAnnotation[] | null {
  const entry = removed.get(key)
  removed.delete(key)
  listeners.forEach(listener => listener())
  return entry && now - entry.at < REMOVED_TTL ? entry.notes : null
}
export function useRemovedAnnotations(key: string | undefined): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => !!key && removed.has(key),
  )
}
export const getAnnotationDraft = (key: string): AnnotationDraft | null => drafts.get(key) ?? null
export function useAnnotationDraft(key: string): AnnotationDraft | null {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => drafts.get(key) ?? null,
  )
}

/**
 * 发送时把批注合进消息：文字块接在用户的话后面，截图排在已有图片后面（一条消息最多 MAX_IMAGE_COUNT 张，放不下的只发文字）。
 * 斜杠命令原样发，不拼批注（sent=false，卡片留着）
 */
export function composeWithAnnotations(
  text: string,
  images: readonly ImageAttachment[],
  draft: AnnotationDraft | null,
): { text: string; images: ImageAttachment[]; sent: boolean } {
  if (!draft || isSlashCommand(text)) return { text, images: [...images], sent: false }
  const block = notesText(draft.notes)
  return {
    text: text.trim() ? `${text.trimEnd()}\n\n${block}` : block,
    images: [...images, ...draft.shots.slice(0, Math.max(0, MAX_IMAGE_COUNT - images.length))],
    sent: true,
  }
}
