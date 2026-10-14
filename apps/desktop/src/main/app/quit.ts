// 窗口全关了要不要退出应用（审查报告 2026-10-14：macOS 上从菜单、托盘、崩溃对话框退出时只关了窗口，应用没退）
/** Windows / Linux：窗口全关就退出。macOS 平时关窗口不退出（留在程序坞），但正在走退出流程时要退 */
export const quitWhenAllClosed = (platform: NodeJS.Platform, quitting: boolean): boolean =>
  platform !== 'darwin' || quitting
