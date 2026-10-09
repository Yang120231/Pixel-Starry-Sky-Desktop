import type { PlatformGroupInfo } from '../shared/types/platform-catalog'

export interface PlatformCatalogBridge {
  groups(): Promise<PlatformGroupInfo[]>
  models(groupId: string): Promise<string[]>
}
