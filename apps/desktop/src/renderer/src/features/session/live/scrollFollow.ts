// 对话流贴底与「回到最新」的判断（docs/ui/conversation-ux.md §2.4），纯函数，LiveTranscript 用

import type { Item } from '@pixelsky/protocol'

/** 离底部不到这么多像素算在底部：新内容到达时自动滚到底，「回到最新」不显示 */
export const STICK_PX = 80

/** 用户点过或按过键之后这么久以内，对话流变高不跟着滚到底（例如刚展开一条工具输出，不要把它顶上去） */
export const INTERACT_MS = 500

export interface ScrollBox {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export const nearBottom = (el: ScrollBox): boolean => el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX

/** 对话流高度变了：贴底、而且用户最近没有操作时才跟到底 */
export const followResize = (stick: boolean, lastInteract: number, now: number): boolean =>
  stick && now - lastInteract >= INTERACT_MS

/** 一条的文字长度：流式输出时它变长，算有新内容 */
function grownLength(item: Item | undefined): number {
  switch (item?.kind) {
    case 'assistant':
    case 'reasoning':
      return item.text.length
    case 'command':
    case 'tool':
      return item.output.length
    default:
      return 0
  }
}

/** 内容标记：条目增加，或者最后一条变长，标记就变；离开底部期间标记变了算「有新内容」 */
export function contentMark(items: readonly Item[]): string {
  const last = items[items.length - 1]
  return `${items.length}:${last?.id ?? ''}:${grownLength(last)}`
}
