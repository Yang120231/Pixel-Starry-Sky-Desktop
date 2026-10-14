// 代码模式里工作区改动打开成文件标签（样式 A）还是「Git 对比」标签（样式 B）：设置的读写（docs/ui/coding-mode.md §3.3.2）
import { useSyncExternalStore } from 'react'
import { GIT_OPEN_KEY, parseGitOpenStyle, type GitOpenStyle } from './gitDiffModel'

function read(): GitOpenStyle {
  try {
    return parseGitOpenStyle(window.localStorage.getItem(GIT_OPEN_KEY))
  } catch {
    return parseGitOpenStyle(null)
  }
}

let choice: GitOpenStyle = typeof window === 'undefined' ? parseGitOpenStyle(null) : read()
const listeners = new Set<() => void>()

export function setGitOpenStyle(next: GitOpenStyle): void {
  choice = parseGitOpenStyle(next)
  try {
    window.localStorage.setItem(GIT_OPEN_KEY, choice)
  } catch {
    // 存储不可用时只在内存里生效
  }
  listeners.forEach(fn => fn())
}

export const getGitOpenStyle = (): GitOpenStyle => choice

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // 别的窗口改了、或云同步写进来
  window.addEventListener('storage', e => {
    if (e.key !== GIT_OPEN_KEY && e.key !== null) return
    choice = read()
    listeners.forEach(fn => fn())
  })
}

export const useGitOpenStyle = (): GitOpenStyle =>
  useSyncExternalStore(
    subscribe,
    () => choice,
    () => parseGitOpenStyle(null),
  )
