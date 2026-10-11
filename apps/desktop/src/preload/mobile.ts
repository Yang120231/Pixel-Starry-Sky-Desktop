import type { MobileAccess, MobilePrefs, MobileState } from '../shared/types/mobile'

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
  onChange(callback: (state: MobileState) => void): () => void
}
