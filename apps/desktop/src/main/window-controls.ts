import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import { trustedSender } from './account'
import type { WindowSnapLayout, WindowState } from '../preload/window'

interface Zone {
  x: number
  y: number
  width: number
  height: number
}

const SNAP_ZONES: Record<WindowSnapLayout, Zone[]> = {
  'columns-2': [
    { x: 0, y: 0, width: 1 / 2, height: 1 },
    { x: 1 / 2, y: 0, width: 1 / 2, height: 1 },
  ],
  'columns-3': [
    { x: 0, y: 0, width: 1 / 3, height: 1 },
    { x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 1 },
  ],
  'large-left': [
    { x: 0, y: 0, width: 2 / 3, height: 1 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 1 / 2 },
    { x: 2 / 3, y: 1 / 2, width: 1 / 3, height: 1 / 2 },
  ],
  'large-right': [
    { x: 0, y: 0, width: 1 / 3, height: 1 / 2 },
    { x: 0, y: 1 / 2, width: 1 / 3, height: 1 / 2 },
    { x: 1 / 3, y: 0, width: 2 / 3, height: 1 },
  ],
  'grid-4': [
    { x: 0, y: 0, width: 1 / 2, height: 1 / 2 },
    { x: 1 / 2, y: 0, width: 1 / 2, height: 1 / 2 },
    { x: 0, y: 1 / 2, width: 1 / 2, height: 1 / 2 },
    { x: 1 / 2, y: 1 / 2, width: 1 / 2, height: 1 / 2 },
  ],
  'wide-center': [
    { x: 0, y: 0, width: 1 / 4, height: 1 },
    { x: 1 / 4, y: 0, width: 1 / 2, height: 1 },
    { x: 3 / 4, y: 0, width: 1 / 4, height: 1 },
  ],
}

const LAYOUTS = new Set<WindowSnapLayout>(Object.keys(SNAP_ZONES) as WindowSnapLayout[])
const snappedWindows = new WeakMap<BrowserWindow, { bounds: Electron.Rectangle; minimum: number[] }>()

export function snapBounds(
  area: Electron.Rectangle,
  layout: WindowSnapLayout,
  index: number,
): Electron.Rectangle | null {
  const zone = SNAP_ZONES[layout]?.[index]
  if (!zone) return null
  const left = Math.round(area.width * zone.x)
  const top = Math.round(area.height * zone.y)
  const right = Math.round(area.width * (zone.x + zone.width))
  const bottom = Math.round(area.height * (zone.y + zone.height))
  if (right - left < 400 || bottom - top < 300) return null
  return { x: area.x + left, y: area.y + top, width: right - left, height: bottom - top }
}

function callingWindow(event: IpcMainInvokeEvent): BrowserWindow {
  if (!trustedSender(event) || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的调用方')
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('窗口已经关闭')
  return win
}

function state(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), focused: win.isFocused(), snapped: snappedWindows.has(win) }
}

export function initWindowControls(): void {
  ipcMain.handle('window:getState', event => state(callingWindow(event)))
  ipcMain.handle('window:minimize', event => {
    callingWindow(event).minimize()
  })
  ipcMain.handle('window:toggleMaximize', event => {
    const win = callingWindow(event)
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:snap', (event, layout: WindowSnapLayout, zone: number) => {
    const win = callingWindow(event)
    if (!LAYOUTS.has(layout) || !Number.isInteger(zone)) throw new Error('窗口布局不正确')
    const zones = SNAP_ZONES[layout]
    const selected = zones[zone]
    if (!selected) throw new Error('窗口区域不正确')
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const bounds = snapBounds(area, layout, zone)
    if (!bounds) throw new Error('当前显示器空间不足，无法使用这个区域')
    if (!snappedWindows.has(win))
      snappedWindows.set(win, { bounds: win.getNormalBounds(), minimum: win.getMinimumSize() })
    if (win.isMaximized()) win.unmaximize()
    // 布局模式允许小于普通窗口的 1100×700；最小保持单窗格可用的 400×300。
    win.setMinimumSize(400, 300)
    win.setBounds(bounds)
    win.webContents.send('window:state', state(win))
  })
  ipcMain.handle('window:snapOptions', event => {
    const win = callingWindow(event)
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    return Object.fromEntries(
      [...LAYOUTS].map(layout => [
        layout,
        SNAP_ZONES[layout].map((_, zone) => snapBounds(area, layout, zone) !== null),
      ]),
    )
  })
  ipcMain.handle('window:restoreSnap', event => {
    const win = callingWindow(event)
    const saved = snappedWindows.get(win)
    if (!saved) return
    if (win.isMaximized()) win.unmaximize()
    snappedWindows.delete(win)
    win.setMinimumSize(saved.minimum[0], saved.minimum[1])
    win.setBounds(saved.bounds)
    win.webContents.send('window:state', state(win))
  })
  // 复用现有 close 事件与文件保存确认，不能用 destroy / app.exit 绕过。
  ipcMain.handle('window:close', event => {
    callingWindow(event).close()
  })
}

export function observeWindowControls(win: BrowserWindow): void {
  const publish = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('window:state', state(win))
  }
  win.on('maximize', publish)
  win.on('unmaximize', publish)
  win.on('focus', publish)
  win.on('blur', publish)
  win.on('restore', publish)
}
