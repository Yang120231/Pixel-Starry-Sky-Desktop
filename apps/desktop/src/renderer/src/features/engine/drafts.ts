// 每个会话共用草稿，切换会话 / 重启不丢；撤回通过函数更新保留已有内容。
import { useCallback, useSyncExternalStore } from 'react'
const STORAGE = 'pixelsky.composer-drafts'
let drafts: Record<string, string> = {}
try {
  const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
  if (saved && typeof saved === 'object' && !Array.isArray(saved))
    drafts = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string'))
} catch {
  /* 使用空草稿 */
}
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 旧版本的新会话共用一个草稿键，升级时交给一个现有新标签，避免复制或丢失。 */
export function migrateNewComposerDraft(key: string): void {
  if (!drafts['new-session'] || drafts[key] !== undefined) return
  drafts = { ...drafts, [key]: drafts['new-session'] }
  delete drafts['new-session']
  try {
    localStorage.setItem(STORAGE, JSON.stringify(drafts))
  } catch {
    /* 当前窗口内仍保留 */
  }
  listeners.forEach(listener => listener())
}

export function useComposerDraft(key: string): [string, (value: string | ((previous: string) => string)) => void] {
  const value = useSyncExternalStore(subscribe, () => drafts[key] ?? '')
  const set = useCallback(
    (next: string | ((previous: string) => string)) => {
      const text = typeof next === 'function' ? next(drafts[key] ?? '') : next
      drafts = { ...drafts, [key]: text }
      if (!text) delete drafts[key]
      try {
        localStorage.setItem(STORAGE, JSON.stringify(drafts))
      } catch {
        /* 当前窗口内仍保留 */
      }
      listeners.forEach(listener => listener())
    },
    [key],
  )
  return [value, set]
}

/** 不在输入框组件里时追加草稿（回退把原文放回发起窗格的输入框）；已有内容时换行追加。 */
export function appendComposerDraft(key: string, text: string): void {
  if (!text) return
  const current = drafts[key] ?? ''
  drafts = { ...drafts, [key]: current ? `${current}\n${text}` : text }
  try {
    localStorage.setItem(STORAGE, JSON.stringify(drafts))
  } catch {
    /* 当前窗口内仍保留 */
  }
  listeners.forEach(listener => listener())
}

/** 撤销回退时去掉回退放进来的原文（只在草稿正好以它结尾时去掉，用户改过就不动） */
export function removeComposerDraftTail(key: string, text: string): void {
  const current = drafts[key] ?? ''
  if (!text || !current.endsWith(text)) return
  const rest = current.slice(0, current.length - text.length).replace(/\n$/, '')
  drafts = { ...drafts, [key]: rest }
  try {
    localStorage.setItem(STORAGE, JSON.stringify(drafts))
  } catch {
    /* 当前窗口内仍保留 */
  }
  listeners.forEach(listener => listener())
}
