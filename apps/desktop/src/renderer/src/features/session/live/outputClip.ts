// 工具输出按字数折叠（docs/perf-audit-2026-10-18.md D5）：原来只按行数折叠，几 MB 的单行输出（压缩过的 JSON、
// 打包产物）会整段挂上页面，一次排版好几秒。超过 OUTPUT_CHARS 只显示开头、结尾各 OUTPUT_EDGE 个字；
// 点「显示全部」也最多显示 OUTPUT_ALL_MAX 个字，再长的去复制或在编辑器里看
export const OUTPUT_CHARS = 64 * 1024
export const OUTPUT_EDGE = 16 * 1024
export const OUTPUT_ALL_MAX = 1024 * 1024

export interface ClippedOutput {
  head: string
  tail: string
  /** 中间省掉的字数 */
  hidden: number
}

/** 不用折叠时为 null */
export function clipOutput(text: string, limit = OUTPUT_CHARS, edge = OUTPUT_EDGE): ClippedOutput | null {
  if (text.length <= limit) return null
  return { head: text.slice(0, edge), tail: text.slice(-edge), hidden: text.length - edge * 2 }
}
