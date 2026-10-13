// RTF（写字板、旧版 Word 存的）→ 文字（docs/ui/composer-file-attachments.md §7.3）：去掉控制字，留下正文。
// 字体表、样式表、图片、页眉页脚这些不要；中文这类按 \ansicpg 或字体的字符集（\fcharset134 是 GBK）解码 \'hh，
// \uN 是 Unicode；表格的格子用 | 隔开，一行一行
import type { FileAttachment } from '@pixelsky/protocol'
import { tr } from '@/i18n/core'
import { documentAttachment } from './document'

export async function readRtf(file: File): Promise<FileAttachment> {
  let text: string
  try {
    text = rtfText(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error(tr('composer.file.broken', { p0: file.name }))
  }
  return documentAttachment(file, 'rtf', text)
}

export const isRtf = (head: Uint8Array): boolean => '{\\rtf'.split('').every((ch, i) => head[i] === ch.charCodeAt(0))

/** 整个是图片、元数据这类的组：里面的字不要 */
const SKIP = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'revtbl',
  'filetbl',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'pgdsctbl',
  'generator',
  'fldinst',
  'bkmkstart',
  'bkmkend',
  'shppict',
  'nonshppict',
  'mmathPr',
])

const SYMBOLS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n\n',
  page: '\n\n',
  tab: '\t',
  cell: ' | ',
  nestcell: ' | ',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' ',
}

/** \fcharset → 代码页 */
const CHARSETS: Record<number, number> = {
  128: 932,
  129: 949,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
}
const LABELS: Record<number, string> = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 65001: 'utf-8' }

function decodeBytes(bytes: number[], codepage: number): string {
  try {
    return new TextDecoder(LABELS[codepage] ?? `windows-${codepage}`).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder('windows-1252').decode(new Uint8Array(bytes))
  }
}

interface State {
  skip: boolean
  /** \uN 后面跟着几个给老软件看的替代字符，要跳过 */
  uc: number
  codepage: number
  fonts: boolean
}

export function rtfText(bytes: Uint8Array): string {
  let src = ''
  for (let i = 0; i < bytes.length; i += 8192) src += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const fontPages = new Map<number, number>()
  let ansi = 1252,
    font = -1
  let state: State = { skip: false, uc: 1, codepage: ansi, fonts: false }
  const stack: State[] = []
  let out = '',
    pending: number[] = [],
    skipChars = 0
  const flush = (): void => {
    if (pending.length) out += decodeBytes(pending, state.codepage)
    pending = []
  }
  const emit = (text: string): void => {
    if (state.skip) return
    flush()
    out += text
  }
  for (let i = 0; i < src.length; ) {
    const ch = src[i]
    if (ch === '{') {
      flush()
      stack.push(state)
      state = { ...state }
      i++
    } else if (ch === '}') {
      flush()
      state = stack.pop() ?? state
      i++
    } else if (ch === '\\') {
      const next = src[i + 1] ?? ''
      if (/[a-z]/i.test(next)) {
        const m = /^([a-z]+)(-?\d+)? ?/i.exec(src.slice(i + 1, i + 40))!
        i += 1 + m[0].length
        const word = m[1],
          param = m[2] === undefined ? undefined : Number(m[2])
        if (SKIP.has(word)) {
          state.skip = true
          if (word === 'fonttbl') state.fonts = true
        } else if (word === 'bin') i += param ?? 0
        else if (word === 'ansicpg' && param) ansi = state.codepage = param
        else if (word === 'uc') state.uc = param ?? 1
        else if (word === 'f' && param !== undefined) {
          if (state.fonts) font = param
          else {
            flush()
            state.codepage = fontPages.get(param) ?? ansi
          }
        } else if (word === 'fcharset' && state.fonts && param !== undefined) {
          if (CHARSETS[param]) fontPages.set(font, CHARSETS[param])
        } else if (word === 'u' && param !== undefined) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param))
          skipChars = state.uc
          continue
        } else if (word === 'row' || word === 'nestrow') {
          if (!state.skip) {
            flush()
            out = out.replace(/ \| $/, '') + '\n'
          }
        } else if (SYMBOLS[word]) emit(SYMBOLS[word])
        skipChars = 0
      } else if (next === "'") {
        const byte = parseInt(src.slice(i + 2, i + 4), 16)
        i += 4
        if (skipChars > 0) skipChars--
        else if (!state.skip && Number.isFinite(byte)) pending.push(byte)
      } else {
        i += 2
        if (next === '*') state.skip = true
        else if (next === '\\' || next === '{' || next === '}') emit(next)
        else if (next === '~') emit(' ')
        else if (next === '_') emit('-')
        else if (next === '\n' || next === '\r') emit('\n')
      }
    } else if (ch === '\n' || ch === '\r') i++
    else {
      i++
      if (skipChars > 0) {
        skipChars--
        continue
      }
      if (state.skip) continue
      const code = ch.charCodeAt(0)
      if (code >= 0x80) pending.push(code)
      else emit(ch)
    }
  }
  flush()
  return out
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim()
}
