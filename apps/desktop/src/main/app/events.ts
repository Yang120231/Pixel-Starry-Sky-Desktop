import { BrowserWindow } from 'electron'
import type { IPC_CONTRACT, IpcChannelName } from '@pixelsky/protocol'
import { isPayWindow } from './payWindowRegistry'
import { sendTo } from './rendererHealth'
import type { HostEvent } from '@pixelsky/protocol'
import { eventForDesktop } from '../core/engine/desktop-images'

/** 契约里主进程推给渲染进程的通道 */
export type PushChannel = {
  [C in IpcChannelName]: (typeof IPC_CONTRACT)[C]['kind'] extends 'push' ? C : never
}[IpcChannelName]

/** 推给所有窗口的事件。只发给还没销毁、没崩溃、不在恢复中的窗口；发给单个窗口的事件（终端输出等）仍由各模块自己发。 */
export class EventBus {
  /** 想和窗口看到同一份事件的模块（手机端，main/mobile/）；在发给窗口之前调用 */
  readonly taps = new Set<(channel: PushChannel, args: unknown[]) => void>()
  broadcast(channel: PushChannel, ...args: unknown[]): void {
    for (const tap of this.taps) tap(channel, args)
    // 窗口拿到的引擎事件里不带图片原图（手机等 tap 已经拿到完整的了，docs/perf-audit-2026-10-18.md B1）
    if (channel === 'engine:event' && args[0]) args = [eventForDesktop(args[0] as HostEvent), ...args.slice(1)]
    // 界面崩溃、重新加载还没报到时 sendTo 会丢掉并计数（app/rendererHealth.ts）
    // 付款窗口里是第三方收银台网页，不广播给它
    for (const win of BrowserWindow.getAllWindows())
      if (!win.isDestroyed() && !isPayWindow(win)) sendTo(win.webContents, channel, ...args)
  }
}
