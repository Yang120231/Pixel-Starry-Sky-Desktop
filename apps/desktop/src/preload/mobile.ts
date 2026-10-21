import type { MobileAccess, MobilePrefs, MobileSeats, MobileState } from '../shared/types/mobile'

/** 设置 › 手机（docs/mobile-remote.md §5.4） */
export interface MobileBridge {
  state(): Promise<MobileState>
  setPrefs(patch: Partial<MobilePrefs>): Promise<MobileState>
  /** 生成配对二维码（5 分钟有效） */
  pairStart(): Promise<MobileState>
  pairCancel(): Promise<MobileState>
  /** 确认或拒绝扫码的手机 */
  pairDecide(accept: boolean): Promise<MobileState>
  revoke(id: string): Promise<MobileState>
  setAccess(id: string, access: MobileAccess): Promise<MobileState>
  /** 远程席位和账号下所有网页设备（跨桌面）；云端旧版本没有这个接口时 available 为 false */
  seats(): Promise<MobileSeats>
  /** 移除账号下其它桌面配对的网页设备（本机配对的用 revoke） */
  removeCloudDevice(id: string): Promise<void>
  onChange(callback: (state: MobileState) => void): () => void
}
