import { extText, type ExtLocale, type ExtPackState } from '@pixelsky/protocol'
import { contributionsFrom } from '../model'

// 提示词的纯函数：填占位符、从扩展状态里列出可用的提示词。不碰 window，node 测试可直接用

export interface PromptVars {
  selection: string
  file: string
  language: string
  project: string
}

const PLACEHOLDER = /\{\{(selection|file|language|project)\}\}/g

/** 一次替换四个占位符：换进去的内容不再扫描（选中的代码里有 {{file}} 也原样保留），不认识的 {{x}} 不动 */
export function fillPrompt(body: string, vars: PromptVars): string {
  return body.replace(PLACEHOLDER, (_, name: keyof PromptVars) => vars[name])
}

export interface PromptItem {
  packKey: string
  packId: string
  id: string
  title: string
  description: string
  /** 提示词文件在扩展包里的路径 */
  path: string
  requiresSelection: boolean
}

/** 某个位置（输入框 / 编辑器）可用的提示词；where 没写时两处都有 */
export function promptItems(state: ExtPackState, where: 'composer' | 'editor', locale: ExtLocale): PromptItem[] {
  return contributionsFrom(state, 'prompts')
    .filter(({ item }) => (item.where ?? ['composer', 'editor']).includes(where))
    .map(({ pack, item }) => ({
      packKey: pack.key,
      packId: pack.id ?? pack.key,
      id: item.id,
      title: extText(item.title, locale),
      description: extText(item.description, locale),
      path: item.path,
      requiresSelection: item.requires === 'selection',
    }))
}
