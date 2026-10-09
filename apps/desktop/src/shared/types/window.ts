export interface WindowState {
  maximized: boolean
  focused: boolean
  snapped: boolean
}
export type WindowSnapLayout = 'columns-2' | 'columns-3' | 'large-left' | 'large-right' | 'grid-4' | 'wide-center'
