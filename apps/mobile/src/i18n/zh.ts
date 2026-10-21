// 手机端的文字（先只有中文；以后接桌面端的 shared/i18n 时按这里的键迁过去）
import type { LinkState } from '@/connection'

export const linkStateText: Record<LinkState, string> = {
  connecting: '正在连接…',
  desktop_offline: '电脑不在线',
  waiting_confirm: '等电脑上确认',
  handshaking: '正在建立加密连接…',
  ready: '已连接',
  removed: '已被电脑移除',
  unrecognized: '电脑上找不到这部手机的配对，可重新扫码',
  incompatible: '电脑版和手机版版本不一致，请更新',
  offline: '没有网络，稍后重试',
  replaced: '已在其他设备连接',
}

export const sessionStateText = {
  idle: '空闲',
  starting: '启动中',
  running: '运行中',
  waiting: '等你处理',
} as const
