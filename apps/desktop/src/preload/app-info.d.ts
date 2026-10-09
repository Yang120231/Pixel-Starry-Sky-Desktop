// 「关于」页用的应用信息：主进程提供，规格见 docs/ui/settings.md §5

import type { AppInfo, AppLink } from '../shared/types/app-info'

export interface AppInfoBridge {
  getInfo(): Promise<AppInfo>
  open(link: AppLink): Promise<void>
}
