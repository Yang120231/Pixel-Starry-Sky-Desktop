// 几处共用的状态文字（中英成对，见 ./index.ts）
import type { LinkState } from '@/connection'
import { L } from './index'

export function linkStateLabel(state: LinkState): string {
  switch (state) {
    case 'connecting':
      return L('正在连接…', 'Connecting…')
    case 'desktop_offline':
      return L('电脑不在线', 'Computer offline')
    case 'waiting_confirm':
      return L('等电脑上确认', 'Waiting for approval on the computer')
    case 'handshaking':
      return L('正在建立加密连接…', 'Setting up an encrypted connection…')
    case 'ready':
      return L('已连接', 'Connected')
    case 'removed':
      return L('已被电脑移除', 'Removed by the computer')
    case 'unrecognized':
      return L(
        '电脑上找不到这部手机的配对，可重新扫码',
        "The computer doesn't recognize this phone. Scan the QR code again.",
      )
    case 'incompatible':
      return L('电脑版和手机版版本不一致，请更新', "Desktop and phone versions don't match. Please update.")
    case 'offline':
      return L('没有网络，稍后重试', 'No network. Retrying soon.')
    case 'replaced':
      return L('已在其他设备连接', 'Connected on another device')
  }
}
