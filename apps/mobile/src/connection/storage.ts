import type { PairRequest } from '@pixelsky/link'

// 配对过的电脑存在本机（localStorage）。网页版只能这样存手机私钥；以后的 App 换成系统钥匙串（docs/mobile-remote.md §4.2）。
export interface Pairing {
  /** 云端分配的设备 ID（中转上的手机 ID） */
  deviceId: string
  /** 设备令牌（只能用于中转） */
  token: string
  desktopId: string
  desktopName: string
  /** 二维码里的中转地址：App 里用它连（网页版和中转同源，用页面地址） */
  relay?: string
  /** 电脑长期公钥（base64url）和指纹 */
  desktopKey: string
  fingerprint: string
  /** 手机长期私钥（base64url） */
  phoneKey: string
  pairedAt: number
  /** pending：等电脑上确认；paired：已配对；removed：被电脑移除（停止重连，提示重新配对） */
  status: 'pending' | 'paired' | 'removed'
  /** 等确认时要发给电脑的配对请求（电脑每次上线都再发一次）；确认后清掉 */
  request?: PairRequest
}

const KEY = 'pixelsky.mobile.pairings'
const ACTIVE = 'pixelsky.mobile.active'

export function loadPairings(): Pairing[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list)
      ? list.filter(p => p && typeof p.deviceId === 'string' && typeof p.token === 'string')
      : []
  } catch {
    return []
  }
}

export function savePairings(list: Pairing[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function activeDevice(): string | null {
  return localStorage.getItem(ACTIVE)
}

export function setActiveDevice(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE, id)
  else localStorage.removeItem(ACTIVE)
}
