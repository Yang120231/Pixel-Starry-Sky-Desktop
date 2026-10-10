// 搜索结果的字段名（docs/ui/workbench-ux-3.md §2.5）：协议和引擎给的是中文原文（旧的远端辅助进程也是），
// 界面显示时按当前语言换。不用按原文整句翻译：同样的字在别处有别的英文（「会话标题」是搜索范围「Conversation titles」）
import { tr, type TranslationKey } from '@/i18n/core'

const FIELDS: Record<string, TranslationKey> = {
  会话标题: 'search.field.title',
  最近会话: 'search.field.recent',
  项目: 'search.field.project',
  用户消息: 'search.field.user',
  助手回复: 'search.field.assistant',
  系统提示: 'search.field.notice',
  命令: 'search.field.command',
  命令说明: 'search.field.commandDescription',
  命令输出: 'search.field.commandOutput',
  工具摘要: 'search.field.toolSummary',
  工具名称: 'search.field.toolName',
  工具输出: 'search.field.toolOutput',
  修改路径: 'search.field.changedPath',
  文件改动: 'search.field.diff',
  待办: 'search.field.todo',
}

/** 不认识的字段（以后新加的、界面自己给的「我的任务」）照原样 */
export function fieldLabel(field: string): string {
  const key = FIELDS[field]
  return key ? tr(key) : field
}

/** 引擎给已经移除的项目写「已移除的项目」；真实的项目名照原样 */
export function projectLabel(name: string): string {
  return name === '已移除的项目' ? tr('search.field.removedProject') : name
}
