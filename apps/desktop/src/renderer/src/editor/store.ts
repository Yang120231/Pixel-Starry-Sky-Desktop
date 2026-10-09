import { useSyncExternalStore } from 'react'
import type { EditorState } from '../../../shared/types/workspace'
import { isDemo } from '@/mock/data'
import { DEMO_EDITOR_STATE } from '@/mock/files'
let state: EditorState | null = null
const listeners = new Set<() => void>()
export function setEditors(next: EditorState): void {
  state = next
  listeners.forEach(l => l())
}
export function useEditors(): EditorState | null {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}
export async function refreshEditors(force = false): Promise<void> {
  setEditors(isDemo ? DEMO_EDITOR_STATE : await window.pixelsky!.editor.state(force))
}
