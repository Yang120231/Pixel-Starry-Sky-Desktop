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
