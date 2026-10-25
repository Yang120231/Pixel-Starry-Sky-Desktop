// 把标题之类的文字变成能放进文件名的样子：路径分隔符和 Windows 不许用的字符、控制字符换成空格，合并空白，按字符数截断
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g

export function safeFileName(name: string, max: number, fallback: string): string {
  const clean = name.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(clean).slice(0, max).join('').trim() || fallback
}
