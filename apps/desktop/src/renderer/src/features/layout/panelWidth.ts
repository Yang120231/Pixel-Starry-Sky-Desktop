// 右侧面板没拖过宽度时的宽度（docs/ui/workbench-ux-3.md §2.3）：先给对话区留 680px，再多的给面板。
// 按侧栏的首选宽度算、不看侧栏开没开，开合侧栏时面板宽度不变。
export const PANEL_MIN_WIDTH = 360
const PANEL_AUTO_MAX = 720
const CONVERSATION_WIDTH = 680

export function autoPanelWidth(windowWidth: number, sidebarWidth: number): number {
  return Math.min(PANEL_AUTO_MAX, Math.max(PANEL_MIN_WIDTH, windowWidth - sidebarWidth - CONVERSATION_WIDTH))
}
