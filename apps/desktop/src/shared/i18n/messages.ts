export type Locale = 'zh-CN' | 'en-US'

/** 语言名称始终使用各自原文，方便从另一种语言切回。 */
export const LOCALE_OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]
