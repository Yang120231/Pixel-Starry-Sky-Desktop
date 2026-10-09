import { useSyncExternalStore } from 'react'
import type { EditorState } from '../../../shared/types/workspace'
import { isDemo } from '@/data'
import { demo } from '@/data/demo'
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
  setEditors(isDemo ? demo().files.editorState : await window.pixelsky!.editor.state(force))
}
