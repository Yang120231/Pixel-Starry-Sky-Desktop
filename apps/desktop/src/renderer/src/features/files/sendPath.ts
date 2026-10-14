// 文件树右键「发送路径到对话」：把文件 / 文件夹写成 @路径 插到对话输入框末尾，光标停在后面
import { tr } from '@/i18n/core'
import { appendComposerInline } from '@/features/engine/drafts'
import { composerTarget, focusComposer } from '@/features/session/composerTarget'
import { quotePath } from '@/features/session/quote'
import { getAppMode } from '@/features/coding/mode'
import { codingLayout } from '@/features/coding/layoutStore'
import { pathMention } from './pathMention'

/**
 * 插到当前的对话输入框；代码模式下先把右边的对话栏打开。
 * root 是文件树这个项目的根目录：和会话的工作目录不同（另一个工作副本）时写完整路径。
 * 没有对话时返回原因。
 */
export function sendPathToChat(file: { root: string; path: string }, folder: boolean): string | null {
  const target = composerTarget()
  if (!target) return tr('editor.quote.noSession')
  appendComposerInline(target.key, pathMention(quotePath(file, target.cwd), folder))
  if (getAppMode() === 'code') codingLayout.showRight('chat')
  focusComposer(target.key)
  return null
}
