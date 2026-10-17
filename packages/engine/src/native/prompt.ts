import { HANDOFF_TAG } from '../handoff'

export const OVERVIEW_PREFIX = '（像素星空补充：'

export interface PromptParts {
  /** 用户自己的话 */
  text: string
  /** 文字交接材料（<pixelsky-handoff>…</pixelsky-handoff>） */
  handoff: string | null
  /** 接力第一轮前面的概要（到第一个空行为止） */
  overview: string | null
}

/** 用户话前面像素星空加的两种东西拆开：文字交接材料（§3.2）和接力的概要 */
export function splitPrompt(raw: string): PromptParts {
  let text = raw
  let handoff: string | null = null
  let overview: string | null = null
  if (text.trimStart().startsWith(`<${HANDOFF_TAG}`)) {
    const close = `</${HANDOFF_TAG}>`
    const i = text.indexOf(close)
    if (i >= 0) {
      handoff = text.slice(text.indexOf(`<${HANDOFF_TAG}`), i + close.length)
      text = text.slice(i + close.length).replace(/^\r?\n(?:\r?\n)?/, '')
    }
  }
  if (text.startsWith(OVERVIEW_PREFIX)) {
    const i = text.indexOf('\n\n')
    if (i >= 0) {
      overview = text.slice(0, i)
      text = text.slice(i + 2)
    }
  }
  return { text, handoff, overview }
}
