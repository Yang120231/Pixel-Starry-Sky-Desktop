import { EXT_LIMITS } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { readPackText } from '../store'
import type { PromptItem } from './model'

/** 读提示词正文；超过字数上限当作失败 */
export async function loadPromptBody(item: PromptItem): Promise<string> {
  const body = await readPackText(item.packKey, item.path)
  if (body.length > EXT_LIMITS.promptChars) throw new Error(tr('prompts.tooLong', { max: EXT_LIMITS.promptChars }))
  return body
}
