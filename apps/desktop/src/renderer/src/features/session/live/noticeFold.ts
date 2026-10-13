// 很长的提示（后台子智能体结束时带回的整份报告等）默认只显示前几行（docs/ui/minimal-mode.md §7）。
// 纯函数：NoticeRow 显示、foldedText 数折叠部分的搜索命中共用
export const NOTICE_PREVIEW_LINES = 3

/**
 * 超过 NOTICE_PREVIEW_LINES 行时：preview 是前几行，rest 是其余的行；不用折时 null。
 * 只按换行切：界面语言换掉的只有第一行的开头，rest 和用哪种语言显示无关
 */
export function foldNotice(text: string): { preview: string; rest: string } | null {
  const lines = text.trimEnd().split('\n')
  if (lines.length <= NOTICE_PREVIEW_LINES) return null
  return {
    preview: lines.slice(0, NOTICE_PREVIEW_LINES).join('\n').trimEnd(),
    rest: lines.slice(NOTICE_PREVIEW_LINES).join('\n'),
  }
}
