// 系统通知（docs/ui/notifications.md）：要不要提醒由渲染层判断，这里只负责弹出、点击回到窗口。
import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { trustedSender } from './account'
import type { NotificationInput } from '../preload/notifications'

const MAX_LIVE = 20
/** 已弹出的通知要保留引用，否则被回收后点击回调不再触发 */
const live = new Map<string, Notification>()

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(`通知参数 ${field} 不正确`)
  return value
}

export function parseNotification(raw: unknown): NotificationInput {
  if (!raw || typeof raw !== 'object') throw new Error('通知参数不正确')
  const input = raw as Record<string, unknown>
  const sessionId = input.sessionId === null || input.sessionId === undefined ? null : text(input.sessionId, 200, 'sessionId')
  return {
    id: text(input.id, 100, 'id'),
    title: text(input.title, 120, 'title'),
    body: text(input.body, 300, 'body'),
    sessionId,
    sound: input.sound === true,
    attention: input.attention === true,
  }
}

function show(win: BrowserWindow, input: NotificationInput): void {
  live.get(input.id)?.close()
  live.delete(input.id)
  const notification = new Notification({ title: input.title, body: input.body, silent: !input.sound })
  const forget = (): void => { if (live.get(input.id) === notification) live.delete(input.id) }
  notification.on('click', () => {
    forget()
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('notify:clicked', { id: input.id, sessionId: input.sessionId })
  })
  notification.on('close', forget)
  notification.on('failed', forget)
  live.set(input.id, notification)
  while (live.size > MAX_LIVE) {
    const [oldest, item] = live.entries().next().value as [string, Notification]
    live.delete(oldest)
    item.close()
  }
  notification.show()
  if (input.attention && !win.isFocused()) {
    win.flashFrame(true)
    win.once('focus', () => { if (!win.isDestroyed()) win.flashFrame(false) })
  }
}

export function initNotifications(): void {
  ipcMain.handle('notify:supported', event => trustedSender(event) && Notification.isSupported())
  ipcMain.handle('notify:show', (event, raw: unknown) => {
    if (!trustedSender(event)) throw new Error('不受信任的页面')
    if (!Notification.isSupported()) return false
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    show(win, parseNotification(raw))
    return true
  })
  // 自动化验证用：开发环境带调试端口时，从主进程 CDP 读取 / 点击已弹出的通知
  if (!app.isPackaged && process.env.PIXELSKY_DEBUG_PORT) {
    ;(globalThis as Record<string, unknown>).__pixelskyNotifications = {
      list: () => [...live.entries()].map(([id, n]) => ({ id, title: n.title, body: n.body, silent: n.silent })),
      click: (id: string) => { live.get(id)?.emit('click') },
    }
  }
}
