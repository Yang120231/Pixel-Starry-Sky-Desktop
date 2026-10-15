import type { Tag } from '@lezer/highlight'
import { tagsForSelector } from '../scopes'

// VS Code 颜色主题（子集）→ CodeMirror 的高亮规则和编辑器配色。纯函数，没有副作用。规则见 docs/extensions/authoring-spec.md §5。

export interface ThemeRule {
  tags: Tag[]
  color?: string
  fontStyle?: 'italic'
  fontWeight?: 'bold'
  textDecoration?: string
}

type Styles = Record<string, Record<string, string>>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** #RGB / #RGBA / #RRGGBB / #RRGGBBAA → 小写的 #rrggbb[aa]；别的写法（rgb()、颜色名）返回 null */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return null
  if (v.length > 5) return v
  return '#' + [...v.slice(1)].map(c => c + c).join('')
}

interface Style {
  color?: string
  italic?: boolean
  bold?: boolean
  underline?: boolean
  strike?: boolean
}

function parseSettings(settings: unknown, warnings: string[]): Style | null {
  if (!isRecord(settings)) return null
  const style: Style = {}
  if (settings.foreground !== undefined) {
    const color = normalizeHex(settings.foreground)
    if (color) style.color = color
    else warnings.push(`tokenColors: invalid foreground ${JSON.stringify(settings.foreground)}`)
  }
  if (typeof settings.fontStyle === 'string') {
    for (const word of settings.fontStyle.split(/\s+/)) {
      if (word === 'italic') style.italic = true
      else if (word === 'bold') style.bold = true
      else if (word === 'underline') style.underline = true
      else if (word === 'strikethrough') style.strike = true
    }
  }
  return style.color || style.italic || style.bold || style.underline || style.strike ? style : null
}

/** tokenColors → 规则：同一个标签被多条规则命中时，选择器长的赢，一样长取后面的 */
export function convertTokenColors(tokenColors: unknown): { rules: ThemeRule[]; warnings: string[] } {
  const warnings: string[] = []
  if (tokenColors === undefined) return { rules: [], warnings }
  if (!Array.isArray(tokenColors)) return { rules: [], warnings: ['tokenColors is not an array'] }
  const best = new Map<Tag, { spec: number; style: Style }>()
  for (const entry of tokenColors) {
    if (!isRecord(entry)) continue
    const style = parseSettings(entry.settings, warnings)
    if (!style) continue
    const scope = entry.scope
    const selectors = (Array.isArray(scope) ? scope : typeof scope === 'string' ? [scope] : [])
      .filter((s): s is string => typeof s === 'string')
      .flatMap(s => s.split(','))
      .map(s => s.trim())
      .filter(Boolean)
    for (const selector of selectors) {
      for (const tag of tagsForSelector(selector)) {
        const prev = best.get(tag)
        if (!prev || selector.length >= prev.spec) best.set(tag, { spec: selector.length, style })
      }
    }
  }
  // 样式一样的标签合成一条规则
  const groups = new Map<string, { style: Style; tags: Tag[] }>()
  for (const [tag, { style }] of best) {
    const key = JSON.stringify(style)
    const group = groups.get(key)
    if (group) group.tags.push(tag)
    else groups.set(key, { style, tags: [tag] })
  }
  const rules: ThemeRule[] = []
  for (const { style, tags } of groups.values()) {
    const rule: ThemeRule = { tags }
    if (style.color) rule.color = style.color
    if (style.italic) rule.fontStyle = 'italic'
    if (style.bold) rule.fontWeight = 'bold'
    const deco = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean)
    if (deco.length) rule.textDecoration = deco.join(' ')
    rules.push(rule)
  }
  return { rules, warnings }
}

function put(styles: Styles, selector: string, props: Record<string, string | null | undefined>): void {
  const defined = Object.entries(props).filter((e): e is [string, string] => typeof e[1] === 'string')
  if (defined.length === 0) return
  styles[selector] = { ...styles[selector], ...Object.fromEntries(defined) }
}

/** colors → 编辑器外观（chrome）和对比视图（diff）的样式；不认识的键忽略 */
export function convertColors(colors: unknown, dark: boolean): { chrome: Styles; diff: Styles } {
  const chrome: Styles = {}
  const diff: Styles = {}
  if (!isRecord(colors)) return { chrome, diff }
  const c = (key: string): string | null => normalizeHex(colors[key])

  const bg = c('editor.background')
  const fg = c('editor.foreground')
  const lineNo = c('editorLineNumber.foreground')
  const lineNoActive = c('editorLineNumber.activeForeground')
  const lineHl = c('editorLineHighlightBackground')
  const sel = c('editor.selectionBackground')
  const inactiveSel = c('editor.inactiveSelectionBackground')
  const caret = c('editorCursor.foreground') ?? fg

  put(chrome, '&', { backgroundColor: bg, color: fg })
  put(chrome, '.cm-content', { caretColor: caret })
  put(chrome, '.cm-cursor, .cm-dropCursor', { borderLeftColor: caret })
  put(chrome, '.cm-gutters', { backgroundColor: bg, color: lineNo })
  put(chrome, '.cm-activeLine', { backgroundColor: lineHl })
  put(chrome, '.cm-activeLineGutter', { backgroundColor: lineHl, color: lineNoActive })

  // 选区：有底色但主题没给选区色时用半透明的黑 / 白，免得落回应用主色
  const selFallback = bg ? (dark ? '#ffffff26' : '#00000022') : null
  const blurred = inactiveSel ?? sel ?? selFallback
  const focused = sel ?? inactiveSel ?? selFallback
  // 选择器和 editorChrome 里的一致（多写的 .cm-editor 才压得过 CodeMirror 自带的选区色）
  put(chrome, '&.cm-editor .cm-selectionBackground, .cm-content ::selection', { backgroundColor: blurred })
  put(chrome, '&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground', {
    backgroundColor: focused,
  })

  const findOther = c('editor.findMatchHighlightBackground')
  const findCurrent = c('editor.findMatchBackground')
  put(chrome, '.cm-searchMatch', { backgroundColor: findOther, outline: findOther ? 'none' : null })
  put(chrome, '.cm-searchMatch-selected', { backgroundColor: findCurrent, outline: findCurrent ? 'none' : null })

  const bracketBg = c('editorBracketMatch.background')
  const bracketBorder = c('editorBracketMatch.border')
  put(chrome, '.cm-matchingBracket', {
    backgroundColor: bracketBg,
    color: bracketBg || bracketBorder ? 'inherit' : null,
    outline: bracketBorder ? `1px solid ${bracketBorder}` : null,
  })

  put(chrome, '.cm-git-added', { borderLeftColor: c('editorGutter.addedBackground') })
  put(chrome, '.cm-git-modified', { borderLeftColor: c('editorGutter.modifiedBackground') })
  put(chrome, '.cm-git-deleted', { borderTopColor: c('editorGutter.deletedBackground') })

  // 对比视图：文字底色用主题给的，整行的用同色淡一点；选择器和 mergeTheme 里的一致
  const added = c('diffEditor.insertedTextBackground')
  const removed = c('diffEditor.removedTextBackground')
  const line = (color: string): string => `color-mix(in srgb, ${color} 45%, transparent)`
  if (removed) {
    put(diff, '&.cm-merge-a .cm-changedLine, .cm-deletedChunk, .cm-deletedLine', { backgroundColor: line(removed) })
    put(diff, '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText', {
      background: removed,
    })
    put(diff, 'del.cm-deletedText', { background: removed })
  }
  if (added) {
    put(
      diff,
      '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine, &:not(.cm-merge-a):not(.cm-merge-b) .cm-changedLine, .cm-insertedLine',
      { backgroundColor: line(added) },
    )
    put(diff, '&.cm-merge-b .cm-changedText, &:not(.cm-merge-a):not(.cm-merge-b) .cm-changedText', {
      background: added,
    })
    put(diff, 'ins.cm-insertedText', { background: added })
  }
  return { chrome, diff }
}

const MAX_INCLUDE_DEPTH = 5

function resolveInclude(from: string, include: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const seg of include.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) throw new Error(`include escapes the extension: ${include}`)
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

/** 展开 include 链（最多 5 层）：colors 子主题覆盖，tokenColors 接在父主题后面（后面的规则优先） */
export async function mergeIncludes(load: (path: string) => Promise<unknown>, themePath: string): Promise<unknown> {
  const walk = async (path: string, depth: number): Promise<unknown> => {
    const doc = await load(path)
    if (!isRecord(doc) || typeof doc.include !== 'string') return doc
    if (depth >= MAX_INCLUDE_DEPTH) throw new Error('theme include chain is too deep')
    const parent = await walk(resolveInclude(path, doc.include), depth + 1)
    const base = isRecord(parent) ? parent : {}
    const baseTokens = Array.isArray(base.tokenColors) ? base.tokenColors : []
    const ownTokens = Array.isArray(doc.tokenColors) ? doc.tokenColors : []
    const rest = { ...doc }
    delete rest.include
    return {
      ...base,
      ...rest,
      colors: { ...(isRecord(base.colors) ? base.colors : {}), ...(isRecord(doc.colors) ? doc.colors : {}) },
      tokenColors: [...baseTokens, ...ownTokens],
    }
  }
  return walk(themePath, 0)
}
