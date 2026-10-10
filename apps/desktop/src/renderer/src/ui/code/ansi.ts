// 命令输出的 ANSI 颜色（docs/ui/content-highlight.md §2 D）。纯函数：把带控制序列的文字拆成带样式的片段。
// 只认 16 色前景 / 背景、粗体、暗色、斜体、下划线；其余控制序列（光标移动、OSC 超链接等）去掉。

export interface AnsiSpan {
  text: string
  /** 0–15，null 为默认颜色 */
  fg: number | null
  bg: number | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
}

type Style = Omit<AnsiSpan, 'text'>

const PLAIN: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false }

/** 有没有需要处理的东西：ESC 控制序列，或进度条用的回车覆盖 */
// eslint-disable-next-line no-control-regex -- 就是要找控制字符
export const hasAnsi = (text: string): boolean => /[\u001b\r]/.test(text)

// CSI（ESC [ … 结束字母）、OSC（ESC ] … BEL 或 ESC \）、其余两字符的 ESC 序列
// eslint-disable-next-line no-control-regex -- 同上
const SEQUENCE = /\u001b\[([0-9;:?<=>]*)[ -/]*([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]?/g
// 换行、制表符以外的控制字符（退格、响铃等）直接去掉
// eslint-disable-next-line no-control-regex -- 同上
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g

/** 一行里的 \r：终端会回到行首覆盖，这里只保留最后一次写的内容（行尾的 \r 是 Windows 换行，不算） */
function lastOverwrite(line: string): string {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
  const at = trimmed.lastIndexOf('\r')
  return at < 0 ? trimmed : trimmed.slice(at + 1)
}

function applySgr(style: Style, params: string): Style {
  const codes = params === '' ? [0] : params.split(/[;:]/).map(p => (p === '' ? 0 : Number(p)))
  let next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) next = { ...PLAIN }
    else if (c === 1) next.bold = true
    else if (c === 2) next.dim = true
    else if (c === 3) next.italic = true
    else if (c === 4) next.underline = true
    else if (c === 22) next.bold = next.dim = false
    else if (c === 23) next.italic = false
    else if (c === 24) next.underline = false
    else if (c >= 30 && c <= 37) next.fg = c - 30
    else if (c >= 90 && c <= 97) next.fg = c - 90 + 8
    else if (c === 39) next.fg = null
    else if (c >= 40 && c <= 47) next.bg = c - 40
    else if (c >= 100 && c <= 107) next.bg = c - 100 + 8
    else if (c === 49) next.bg = null
    else if (c === 38 || c === 48) {
      // 38;5;n / 48;5;n：只认前 16 色；38;2;r;g;b 真彩色忽略
      const key = c === 38 ? 'fg' : 'bg'
      if (codes[i + 1] === 5) {
        const n = codes[i + 2]
        next[key] = n >= 0 && n < 16 ? n : null
        i += 2
      } else if (codes[i + 1] === 2) {
        next[key] = null
        i += 4
      }
    }
  }
  return next
}

const sameStyle = (a: Style, b: Style): boolean =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  a.bold === b.bold &&
  a.dim === b.dim &&
  a.italic === b.italic &&
  a.underline === b.underline

/** 带 ANSI 控制序列的文字 → 带样式的片段（相邻同样式的合并） */
export function parseAnsi(input: string): AnsiSpan[] {
  const text = input.includes('\r') ? input.split('\n').map(lastOverwrite).join('\n') : input
  const out: AnsiSpan[] = []
  let style: Style = { ...PLAIN }
  const push = (chunk: string): void => {
    const clean = chunk.replace(CONTROL, '')
    if (!clean) return
    const last = out.at(-1)
    if (last && sameStyle(last, style)) last.text += clean
    else out.push({ text: clean, ...style })
  }
  let at = 0
  for (const m of text.matchAll(SEQUENCE)) {
    push(text.slice(at, m.index))
    if (m[2] === 'm') style = applySgr(style, m[1] ?? '')
    at = m.index + m[0].length
  }
  push(text.slice(at))
  return out
}

/** 去掉所有控制序列，只留文字（复制、搜索用） */
export const stripAnsi = (text: string): string =>
  parseAnsi(text)
    .map(s => s.text)
    .join('')
