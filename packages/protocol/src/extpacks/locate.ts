// 把 JSON Pointer 换成文件里的行列（给错误位置用）。容忍注释和结尾逗号；纯 TS。

class Bad extends Error {}

function unescapePointer(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~')
}

/**
 * 返回指针指向的「值」的起点（行、列都从 1 起，列按 UTF-16 码元，CRLF 算一个换行）。
 * 精确的指针找不到时返回找到的最深的上一层；文本读不懂时返回 null。
 */
export function locateJsonPointer(text: string, pointer: string): { line: number; column: number } | null {
  if (pointer !== '' && !pointer.startsWith('/')) return null
  const segs = pointer === '' ? [] : pointer.slice(1).split('/').map(unescapePointer)
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const n = text.length
  let pos = start

  const ws = (): void => {
    for (;;) {
      const ch = text[pos]
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') pos++
      else if (ch === '/' && text[pos + 1] === '/') {
        while (pos < n && text[pos] !== '\n') pos++
      } else if (ch === '/' && text[pos + 1] === '*') {
        const end = text.indexOf('*/', pos + 2)
        if (end < 0) throw new Bad()
        pos = end + 2
      } else return
    }
  }
  const str = (): string => {
    const from = pos
    pos++
    while (pos < n && text[pos] !== '"') {
      if (text[pos] === '\\') pos++
      if (text[pos] === '\n') throw new Bad()
      pos++
    }
    if (pos >= n) throw new Bad()
    pos++
    try {
      return JSON.parse(text.slice(from, pos)) as string
    } catch {
      throw new Bad()
    }
  }
  /** 跳过一个值（pos 在值的第一个字符） */
  const skip = (): void => {
    const ch = text[pos]
    if (ch === '"') {
      str()
    } else if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']'
      pos++
      ws()
      while (pos < n && text[pos] !== close) {
        if (ch === '{') {
          if (text[pos] !== '"') throw new Bad()
          str()
          ws()
          if (text[pos] !== ':') throw new Bad()
          pos++
          ws()
        }
        skip()
        ws()
        if (text[pos] === ',') {
          pos++
          ws()
        } else if (text[pos] !== close) throw new Bad()
      }
      if (pos >= n) throw new Bad()
      pos++
    } else {
      const from = pos
      while (pos < n && !/[\s,}\]/]/.test(text[pos])) pos++
      if (pos === from) throw new Bad()
    }
  }
  /** pos 在值的第一个字符：返回要找的值的起点（找不到就是这一层的起点） */
  const walk = (depth: number): number => {
    const here = pos
    if (pos >= n) throw new Bad()
    if (depth >= segs.length) return here
    const want = segs[depth]
    const ch = text[pos]
    if (ch === '{') {
      pos++
      ws()
      while (pos < n && text[pos] !== '}') {
        if (text[pos] !== '"') throw new Bad()
        const key = str()
        ws()
        if (text[pos] !== ':') throw new Bad()
        pos++
        ws()
        if (key === want) return walk(depth + 1)
        skip()
        ws()
        if (text[pos] === ',') {
          pos++
          ws()
        } else if (text[pos] !== '}') throw new Bad()
      }
      return here
    }
    if (ch === '[') {
      const target = /^(0|[1-9]\d*)$/.test(want) ? Number(want) : -1
      let i = 0
      pos++
      ws()
      while (pos < n && text[pos] !== ']') {
        if (i === target) return walk(depth + 1)
        skip()
        i++
        ws()
        if (text[pos] === ',') {
          pos++
          ws()
        } else if (text[pos] !== ']') throw new Bad()
      }
      return here
    }
    return here
  }

  let offset: number
  try {
    ws()
    if (pos >= n) return null
    offset = walk(0)
  } catch (e) {
    if (e instanceof Bad) return null
    throw e
  }
  let line = 1
  let lineStart = start
  for (let i = start; i < offset; i++) {
    const c = text[i]
    if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}
