import type { WorkspaceRef } from './workspace'
export interface BrowserAnnotation {
  id: string
  text: string
  url: string
}
export interface BrowserPage {
  id: string
  url: string
  title: string
  loading: boolean
  error: string | null
  canBack: boolean
  canForward: boolean
  annotations: BrowserAnnotation[]
  /** Original remote address; the local SSH forwarding port is never the saved workspace target. */
  remoteUrl?: string
}
export interface BrowserState {
  scope: string
  pages: BrowserPage[]
  activeId: string | null
}
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
