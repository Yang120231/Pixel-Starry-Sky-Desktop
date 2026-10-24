import type { PlatformGroupInfo, PlatformKeyMode } from '../shared/types/platform-catalog'

export interface PlatformCatalogBridge {
  groups(): Promise<PlatformGroupInfo[]>
  models(groupId: string): Promise<string[]>
  /** 扣费用的 Key（docs/ui/platform-key-mode.md） */
  keyMode(): Promise<PlatformKeyMode>
  setKeyMode(mode: PlatformKeyMode): Promise<PlatformKeyMode>
}
