export interface TerminalScreen {
  focus(): void
  clear(): void
  find(query: string, backwards?: boolean): boolean
  endSearch(): void
  copy(): Promise<void>
  paste(text: string): void
  bottom(): void
}
export const screens = new Map<string, TerminalScreen>()
