// 扩展包用到的纯文本工具：JSONC 解析、SVG 安全检查、版本范围、颜色对比度。纯 TS，不依赖 node。

/** 把注释换成空格（保留换行，报错行号才对得上），并去掉 } ] 前面的结尾逗号 */
function stripJsonc(text: string): string {
  const out: string[] = []
  let lastComma = -1 // out 里最近一个「有效记号」是逗号时它的下标
  let i = 0
  let line = 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"') {
      // 字符串：原样复制到结束引号
      let j = i + 1
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j++
        if (text[j] === '\n') break
        j++
      }
      out.push(text.slice(i, j + 1))
      lastComma = -1
      i = j + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) throw new SyntaxError(`块注释没有结束（第 ${line} 行）`)
      for (; i < end + 2; i++) {
        if (text[i] === '\n') {
          line++
          out.push('\n')
        } else out.push(' ')
      }
      continue
    }
    if (ch === '\n') line++
    if (ch === ',') {
      lastComma = out.length
    } else if (ch === '}' || ch === ']') {
      if (lastComma >= 0) out[lastComma] = ' '
      lastComma = -1
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
      lastComma = -1
    }
    out.push(ch)
    i++
  }
  return out.join('')
}

/** 允许注释和结尾逗号，去掉 BOM；失败抛 SyntaxError（带行号） */
export function parseJsonc(text: string): unknown {
  const src = stripJsonc(text.replace(/^\uFEFF/, ''))
  try {
    return JSON.parse(src)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const m = /position (\d+)/.exec(msg)
    if (m && !/\bline \d+/.test(msg)) {
      const line = src.slice(0, Number(m[1])).split('\n').length
      throw new SyntaxError(`${msg}（第 ${line} 行）`)
    }
    throw new SyntaxError(msg)
  }
}

/** 不安全就返回原因，安全返回 null */
export function checkSvg(text: string): string | null {
  const s = text.toLowerCase()
  if (s.includes('<script')) return '<script>'
  if (s.includes('<foreignobject')) return '<foreignObject>'
  if (s.includes('<iframe') || s.includes('<embed') || s.includes('<object')) return 'embedded content'
  // 带命名空间前缀的元素（<svg:script>）和动画元素（用 set / animate 在运行时改属性）
  if (/<\/?[a-z0-9_.-]+:(?:script|foreignobject|iframe|embed|object|handler)[\s/>]/.test(s))
    return 'prefixed script element'
  if (/<(?:set|animate|animatemotion|animatetransform)[\s/>]/.test(s)) return 'animation element'
  if (/attributename\s*=\s*["']?\s*(?:on|(?:xlink:)?href)/.test(s)) return 'animated event or href'
  if (s.includes('<!entity')) return '<!ENTITY>'
  if (/[\s"'/]on[a-z]+\s*=/.test(s)) return 'on* event attribute'
  for (const m of s.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!value.startsWith('#')) return 'external href'
  }
  for (const m of s.matchAll(/url\(\s*(['"]?)\s*([^)'"]*)/g)) {
    if (!m[2].trim().startsWith('#')) return 'external url()'
  }
  if (/@import/.test(s)) return '@import'
  return null
}

type Ver = [number, number, number]

function parseVer(text: string): Ver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function cmpVer(a: Ver, b: Ver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** 部分版本号：1 / 1.x / 1.2 / 1.2.3（带不带预发布后缀都行）；null = 解析不了 */
function parsePartial(text: string): { n: number[] } | null {
  const body = text.replace(/^v/, '').replace(/[-+].*$/, '')
  if (body === '' || body === '*' || body.toLowerCase() === 'x') return { n: [] }
  const parts = body.split('.')
  if (parts.length > 3) return null
  const n: number[] = []
  for (const p of parts) {
    if (/^[xX*]$/.test(p)) break
    if (!/^\d+$/.test(p)) return null
    n.push(Number(p))
  }
  return { n }
}

type Bound = { op: '>=' | '<' | '='; v: Ver }

/** 一个比较器展开成若干「>= / < / =」条件，全部满足才算满足 */
function expandComparator(token: string): Bound[] | null {
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token)
  if (!m || m[2] === '') return null
  const op = m[1] ?? ''
  const p = parsePartial(m[2])
  if (!p) return null
  const [a, b, c] = p.n
  const v = (x: number, y = 0, z = 0): Ver => [x, y, z]
  // 通配：* / x
  if (p.n.length === 0) return op === '<' || op === '>' ? null : []
  const lowFull = v(a, b ?? 0, c ?? 0)
  // 部分版本号的「下一个」：1 -> 2.0.0，1.2 -> 1.3.0
  const next: Ver = p.n.length === 1 ? v(a + 1) : p.n.length === 2 ? v(a, b + 1) : v(a, b, c + 1)
  switch (op) {
    case '>=':
      return [{ op: '>=', v: lowFull }]
    case '>':
      return [{ op: '>=', v: next }]
    case '<':
      return [{ op: '<', v: lowFull }]
    case '<=':
      return [{ op: '<', v: next }]
    case '^': {
      let hi: Ver
      if (a > 0 || p.n.length === 1) hi = v(a + 1)
      else if (b > 0 || p.n.length === 2) hi = v(0, b + 1)
      else hi = v(0, 0, c + 1)
      return [
        { op: '>=', v: lowFull },
        { op: '<', v: hi },
      ]
    }
    case '~': {
      const hi: Ver = p.n.length === 1 ? v(a + 1) : v(a, b + 1)
      return [
        { op: '>=', v: lowFull },
        { op: '<', v: hi },
      ]
    }
    default: // '' 或 '='：完整版本是相等，部分版本是一段范围
      if (p.n.length === 3) return [{ op: '=', v: lowFull }]
      return [
        { op: '>=', v: lowFull },
        { op: '<', v: next },
      ]
  }
}

/** 支持 >= > <= < =、裸版本、^、~、x / *、空格分隔的「并且」；其他写法（含 ||）返回 null */
export function satisfiesEngine(range: string, version: string): boolean | null {
  const ver = parseVer(version)
  if (!ver) return null
  const normalized = range.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
  if (normalized === '') return null
  const bounds: Bound[] = []
  for (const token of normalized.split(/\s+/)) {
    if (token === '-' || token === '||') return null // 区间 a - b、或 || 不支持
    const list = expandComparator(token)
    if (!list) return null
    bounds.push(...list)
  }
  return bounds.every(b => {
    const c = cmpVer(ver, b.v)
    return b.op === '>=' ? c >= 0 : b.op === '<' ? c < 0 : c === 0
  })
}

/** #RGB #RGBA #RRGGBB #RRGGBBAA；a 取 0–1 */
export function parseHexColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(value.trim())
  if (!m) return null
  let h = m[1]
  if (h.length <= 4) h = [...h].map(c => c + c).join('')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
}

function luminance(c: { r: number; g: number; b: number }): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

/** WCAG 对比度（1–21）；前景带透明度时先叠到背景上；写法不对返回 null */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseHexColor(fg)
  const b = parseHexColor(bg)
  if (!f || !b) return null
  const mix = (x: number, y: number) => x * f.a + y * (1 - f.a)
  const top = { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b) }
  const l1 = luminance(top)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
