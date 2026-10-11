// 手机端（docs/mobile-remote.md §5）：主进程和设置 › 手机之间传的东西
import type { Item, SessionSnapshot } from '@pixelsky/protocol'

/** 手机的权限档位：只看，或者也能审批、发消息、停止、新建任务 */
export type MobileAccess = 'view' | 'act'

export interface MobileDevice {
  /** 手机在中转上的 ID，配对时由手机生成 */
  id: string
  name: string
  /** 手机长期公钥的指纹（配对时两边显示同一串） */
  fingerprint: string
  access: MobileAccess
  pairedAt: number
  lastSeenAt: number | null
  /** 现在有没有加密连接 */
  online: boolean
}

export interface MobilePrefs {
  /** 允许手机远程连接（默认关） */
  enabled: boolean
  /** 中转地址；空的时候用云端服务（MobileState.relayDefault） */
  relay: string
  /** 有任务在运行时不让电脑睡眠 */
  keepAwake: boolean
}

/** 到中转的连接 */
export type MobileLinkStatus = 'off' | 'connecting' | 'online' | 'error'

export interface MobilePairing {
  /** 二维码里的文本 */
  offer: string
  expires: number
  /** 有手机扫码发来请求时，等用户确认 */
  request: { name: string; fingerprint: string } | null
  status: 'waiting' | 'confirm' | 'accepted' | 'rejected' | 'expired'
}

export interface MobileState {
  prefs: MobilePrefs
  status: MobileLinkStatus
  /** 连不上中转时的原因（错误代码） */
  error: string | null
  desktopName: string
  /** 不填中转地址时用的云端中转 */
  relayDefault: string
  /** 电脑长期公钥的指纹；系统加密不可用时为 null（不能配对） */
  fingerprint: string | null
  devices: MobileDevice[]
  pairing: MobilePairing | null
}

/** engine:openSessionTail 的结果：只有最后一段条目，去掉了图片、截断了长文本（§5.2） */
export interface SessionTail {
  snapshot: SessionSnapshot
  seq: number
  /** 会话总条数 */
  total: number
  /** 还有更早的条目时，向上翻页传这个 id 作为 before；没有更早的为 null */
  before: string | null
  /** 被截断过的条目 id（显示「查看完整」） */
  truncated: string[]
}

/** engine:itemDetail 的结果：一条的完整内容（长文本放宽到 256 KB，图片放得下才带上） */
export interface ItemDetail {
  item: Item
  truncated: boolean
}
