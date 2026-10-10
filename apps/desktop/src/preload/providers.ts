import type { ProviderInput, ProvidersState, ProviderTestResult, ProviderView } from '../shared/types/providers'

/** 自定义 API（docs/ui/custom-api.md §4.4）：Key 只进不出，返回的都打了码 */
export interface ProvidersBridge {
  list(): Promise<ProvidersState>
  save(input: ProviderInput): Promise<ProviderView>
  remove(id: string): Promise<void>
  /** 对话框里的配置（可以还没保存；Key 留空沿用已保存的） */
  test(input: ProviderInput): Promise<ProviderTestResult>
  models(input: ProviderInput): Promise<string[]>
  onChange(callback: (state: ProvidersState) => void): () => void
}
