// 终端输出里的文件路径（docs/ui/files-search-terminal-pins.md §4.2）：找出候选路径和行列，
// 换成相对项目根目录的路径；项目外或解析不了的不标链接，不猜。

export interface PathMatch {
  /** 在这一行文字里的起止（0 起，end 不含） */
  start: number
  end: number
  /** 原文里的路径部分 */
  raw: string
  line: number | null
  column: number | null
}

// 路径：可选的盘符 / ./ / ../ / 斜杠开头，若干目录段，最后一段带扩展名（扩展名以字母开头，排除 1.2.3 这类版本号）。
// 后面可跟 :行 或 :行:列，或 TypeScript / MSBuild 风格的 (行,列)。前面不能紧挨着字母、数字、点或斜杠（排除网址中段）。
const PATH =
  /(?<![\w./\\:-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@$+~-]+[\\/])*[\w@$+~-][\w.@$+~-]*\.[A-Za-z]\w{0,9})(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))?/g

export function findPathMatches(text: string): PathMatch[] {
  const out: PathMatch[] = []
  for (const m of text.matchAll(PATH)) {
    const raw = m[1]
    // 网址里的路径（https://host/a.js）由网址链接处理
    if (/^[a-z][\w+.-]*:\/\//i.test(text.slice(Math.max(0, m.index - 12), m.index + raw.length))) continue
    const line = m[2] ?? m[4],
      column = m[3] ?? m[5]
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      raw,
      line: line ? Number(line) : null,
      column: column ? Number(column) : null,
    })
  }
  return out
}

/** 去掉 . 和 ..，统一用 /；越过根时返回 null */
function normalize(path: string): string | null {
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? ''
  const rest = path.slice(drive.length)
  const absolute = rest.startsWith('/')
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return drive + (absolute ? '/' : '') + parts.join('/')
}

/**
 * 把终端里的路径换成相对项目根目录的路径。
 * cwd 是终端的工作目录，root 是项目根目录（都是绝对路径）；windows 时不区分大小写。
 */
export function projectPath(raw: string, cwd: string, root: string, windows: boolean): string | null {
  const slash = (p: string): string => p.replaceAll('\\', '/')
  const input = slash(raw)
  const absolute = /^[A-Za-z]:\//.test(input) || input.startsWith('/')
  const full = normalize(absolute ? input : slash(cwd).replace(/\/$/, '') + '/' + input)
  const base = normalize(slash(root).replace(/\/$/, ''))
  if (!full || !base) return null
  const same = (a: string, b: string): boolean => (windows ? a.toLowerCase() === b.toLowerCase() : a === b)
  const prefix = full.slice(0, base.length)
  if (!same(prefix, base) || full[base.length] !== '/') return null
  const relative = full.slice(base.length + 1)
  return relative && !relative.split('/').includes('..') ? relative : null
}
