import type { AccountBridge } from './account'
import type { AppInfoBridge } from './app-info'
import type { EngineBridge } from './engine'
import type { PlatformCatalogBridge } from './platform-catalog'
import type { EditorBridge, FilesBridge } from './workspace'
import type { WindowBridge } from './window'
import type { ExtensionsBridge } from './extensions'
import type { ProjectToolsBridge } from './project-tools'
import type { TerminalBridge } from './terminal'
import type { NotificationsBridge } from './notifications'
import type { ArtifactsBridge } from './artifacts'

export type * from './account'
export type * from './app-info'
export type * from './engine'
export type * from './project-tools'
export type * from './terminal'
export type * from './notifications'
export type * from './artifacts'

export interface PixelskyBridge {
  machines: import('./machines').MachineBridge
  extensions: ExtensionsBridge
  platform: NodeJS.Platform | string
  demo: boolean
  /** 同步窗口底色；transparent 仅供其他平台的原生覆盖层使用 */
  setTheme: (theme: 'light' | 'dark', transparent?: boolean) => void
  setLocale: (locale: 'zh-CN' | 'en-US') => Promise<void>
  /** 账号登录与额度（docs/ui/account.md） */
  account: AccountBridge
  /** 引擎系统：项目、会话、对话（docs/engines.md） */
  engine: EngineBridge
  platformCatalog: PlatformCatalogBridge
  /** 「关于」页：版本与运行环境（docs/ui/settings.md §5） */
  app: AppInfoBridge
  files: FilesBridge
  editor: EditorBridge
  window: WindowBridge
  projectTools: ProjectToolsBridge
  projectBrowser: import('./project-browser').BrowserBridge
  terminal: TerminalBridge
  /** 系统通知（docs/ui/notifications.md） */
  notifications: NotificationsBridge
  /** 产物面板（docs/ui/artifacts-panel.md） */
  artifacts: ArtifactsBridge
}

declare global {
  interface Window {
    pixelsky?: PixelskyBridge
    /** 截图模式用：直接切换主题（见 src/main/index.ts） */
    __pixelskySetTheme?: (theme: 'light' | 'dark') => void
  }
}
