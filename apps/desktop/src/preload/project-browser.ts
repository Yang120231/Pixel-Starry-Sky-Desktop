import type { WorkspaceRef } from '../shared/types/workspace'
import type { BrowserState } from '../shared/types/project-browser'

export interface BrowserBridge {
  state(ref: WorkspaceRef): Promise<BrowserState>
  navigate(ref: WorkspaceRef, id: string | null, url: string): Promise<BrowserState>
  select(ref: WorkspaceRef, id: string | null): Promise<BrowserState>
  action(ref: WorkspaceRef, id: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'close'): Promise<BrowserState>
  viewport(ref: WorkspaceRef, bounds: { x: number; y: number; width: number; height: number } | null): Promise<void>
  annotate(ref: WorkspaceRef, id: string, text: string): Promise<BrowserState>
  removeAnnotation(ref: WorkspaceRef, id: string, annotationId: string): Promise<BrowserState>
  onChange(cb: (state: BrowserState) => void): () => void
}
