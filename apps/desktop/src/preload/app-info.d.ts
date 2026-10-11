// 「关于」页用的应用信息：主进程提供，规格见 docs/ui/settings.md §5

import type { AppInfo, AppLink, WhatsNewState } from '../shared/types/app-info'

export interface AppInfoBridge {
  getInfo(): Promise<AppInfo>
  open(link: AppLink): Promise<void>
  /** 更新后的「更新内容」弹窗：要不要弹、是否关了提示 */
  whatsNew(): Promise<WhatsNewState>
  /** seen：这一版看过了；muted：「不再提示」开关 */
  setWhatsNew(patch: { seen?: true; muted?: boolean }): Promise<void>
}
