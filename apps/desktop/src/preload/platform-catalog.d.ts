export interface PlatformGroupInfo {
  supported_engines?: Array<'claude' | 'codex'>
  supported_apis?: string[]
  id: string
  name: string
  description: string
  platform: string
  rate_multiplier: number
  billing_source: string
  models: string[]
}

export interface PlatformCatalogBridge {
  groups(): Promise<PlatformGroupInfo[]>
  models(groupId: string): Promise<string[]>
}
