export interface PlatformGroupInfo {
  supported_engines?: Array<'claude' | 'codex' | 'pixel'>
  supported_apis?: string[]
  id: string
  name: string
  description: string
  platform: string
  rate_multiplier: number
  billing_source: string
  models: string[]
}
