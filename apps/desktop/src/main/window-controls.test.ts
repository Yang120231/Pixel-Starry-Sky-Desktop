import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent) => unknown>(),
  trusted: vi.fn(),
  fromWebContents: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: { handle: (name: string, handler: (event: IpcMainInvokeEvent) => unknown) => mocks.handlers.set(name, handler) },
}))
vi.mock('./account', () => ({ trustedSender: mocks.trusted }))

import { initWindowControls, snapBounds } from './window-controls'

describe('显示器工作区布局', () => {
  it('负坐标显示器三列无缝覆盖工作区，排除任务栏', () => {
    const area = { x: -2561, y: 0, width: 2561, height: 1392 }
    const zones = [0, 1, 2].map(i => snapBounds(area, 'columns-3', i)!)
    expect(zones[0].x).toBe(area.x)
    expect(zones[0].x + zones[0].width).toBe(zones[1].x)
    expect(zones[1].x + zones[1].width).toBe(zones[2].x)
    expect(zones[2].x + zones[2].width).toBe(0)
    expect(zones.every(z => z.y === 0 && z.height === 1392)).toBe(true)
  })
  it('四宫格奇数像素无缝对齐，且使用副屏原点', () => {
    const area = { x: 1920, y: -100, width: 1921, height: 1041 }
    const a = snapBounds(area, 'grid-4', 0)!, b = snapBounds(area, 'grid-4', 1)!, c = snapBounds(area, 'grid-4', 2)!, d = snapBounds(area, 'grid-4', 3)!
    expect(a.x + a.width).toBe(b.x)
    expect(a.y + a.height).toBe(c.y)
    expect(d.x + d.width).toBe(area.x + area.width)
    expect(d.y + d.height).toBe(area.y + area.height)
  })
  it('空间不足或非法区域返回不可用', () => {
    expect(snapBounds({ x: 0, y: 0, width: 1100, height: 700 }, 'wide-center', 0)).toBeNull()
    expect(snapBounds({ x: 0, y: 0, width: 1920, height: 580 }, 'grid-4', 0)).toBeNull()
    expect(snapBounds({ x: 0, y: 0, width: 1920, height: 1080 }, 'columns-2', -1)).toBeNull()
  })
})

describe('窗口操作调用方边界', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    initWindowControls()
  })
  const event = (subframe = false): IpcMainInvokeEvent => {
    const mainFrame = { url: 'file:///app/index.html' }
    return { sender: { mainFrame }, senderFrame: subframe ? { url: mainFrame.url } : mainFrame } as unknown as IpcMainInvokeEvent
  }
  it('不允许外部页面读取或操控窗口', () => {
    mocks.trusted.mockReturnValue(false)
    for (const handler of mocks.handlers.values()) expect(() => handler(event())).toThrow('不允许的调用方')
    expect(mocks.fromWebContents).not.toHaveBeenCalled()
  })
  it('即使地址可信，子框架也不能操控所属窗口', () => {
    mocks.trusted.mockReturnValue(true)
    for (const handler of mocks.handlers.values()) expect(() => handler(event(true))).toThrow('不允许的调用方')
    expect(mocks.fromWebContents).not.toHaveBeenCalled()
  })
  it('窗口已关闭或调用方没有窗口时，不回退到其他窗口', () => {
    mocks.trusted.mockReturnValue(true)
    for (const win of [null, { isDestroyed: () => true }]) {
      mocks.fromWebContents.mockReturnValue(win)
      for (const handler of mocks.handlers.values()) expect(() => handler(event())).toThrow('窗口已经关闭')
    }
  })
})
