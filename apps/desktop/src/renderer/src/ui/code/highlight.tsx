import { tr } from '../../i18n/core'
// 语法高亮（参考 Mirasim：highlight.js 的词法 + 设计变量 --syn-* 着色）。规格见 docs/ui/code-highlight.md
//
// 用 lowlight（highlight.js 输出 hast 语法树）再转成 React 元素，不拼 HTML 字符串，内容不会被当成标签执行。
import { Fragment, type ReactNode } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { common, createLowlight } from 'lowlight'
import type { Root } from 'hast'

// common：highlight.js 的 37 种常用语言（TS/JS、Python、Rust、Go、Shell、JSON、YAML、CSS、HTML、SQL、diff 等）
const lowlight = createLowlight(common)

/** 代码块标注的语言名 → highlight.js 认得的名字（大多数别名 highlight.js 自己就认） */
const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  kt: 'kotlin',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  jsonc: 'json',
  json5: 'json',
  vue: 'xml',
  svelte: 'xml',
  html: 'xml',
  svg: 'xml',
  toml: 'ini',
  dockerfile: 'bash',
  text: 'plaintext',
  txt: 'plaintext',
}

/** 文件扩展名 → 语言（给 diff 用） */
const EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  pl: 'perl',
  r: 'r',
  scss: 'scss',
  less: 'less',
  css: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  svelte: 'xml',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  makefile: 'makefile',
  mk: 'makefile',
  diff: 'diff',
  patch: 'diff',
}

/** 代码块上显示的语言名 */
const LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  bash: 'Shell',
  powershell: 'PowerShell',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sql: 'SQL',
  markdown: 'Markdown',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  ruby: 'Ruby',
  php: 'PHP',
  lua: 'Lua',
  ini: 'TOML / INI',
  diff: 'Diff',
  makefile: 'Makefile',
  graphql: 'GraphQL',
  get plaintext() {
    return tr('code.highlight.plainText')
  },
}

/** 规范化语言名；highlight.js 不认识时返回 null（按纯文本显示） */
export function resolveLanguage(lang: string | null | undefined): string | null {
  if (!lang) return null
  const key = lang.trim().toLowerCase()
  const name = ALIASES[key] ?? key
  if (name === 'plaintext') return null
  return lowlight.registered(name) ? name : null
}

/** 由文件路径猜语言（diff 用）；猜不出返回 null */
export function languageFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile') return 'bash'
  if (base === 'makefile') return 'makefile'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return resolveLanguage(EXTENSIONS[ext] ?? null)
}

/** 代码块标题栏显示的语言名：认识的用正式名，不认识的原样显示，没标注返回 null */
export function languageLabel(lang: string | null | undefined): string | null {
  if (!lang) return null
  const resolved = resolveLanguage(lang)
  if (resolved) return LABELS[resolved] ?? resolved
  return lang.trim() || null
}

/** 太长的内容不高亮（highlight.js 是同步的，几万行会卡住界面），直接按纯文本显示 */
const MAX_LENGTH = 100_000

/** 把一段代码高亮成 React 元素；lang 为 null 或内容过长时原样返回文字 */
export function highlight(code: string, lang: string | null): ReactNode {
  if (!lang || code.length > MAX_LENGTH) return code
  let tree: Root
  try {
    tree = lowlight.highlight(lang, code)
  } catch {
    return code
  }
  return toJsxRuntime(tree, { Fragment, jsx, jsxs })
}

/**
 * 按行高亮：先整段高亮（多行注释、字符串跨行时颜色才对），再按换行切开，每行一个 ReactNode。
 * diff 视图每行有自己的底色，所以需要逐行拿到结果。
 */
export function highlightLines(code: string, lang: string | null): ReactNode[] {
  const lines = code.split('\n')
  if (!lang || code.length > MAX_LENGTH) return lines
  let tree: Root
  try {
    tree = lowlight.highlight(lang, code)
  } catch {
    return lines
  }
  // 把 hast 拍平成 [文字, 所在 span 的 class] 序列，再按 \n 断行重建
  type Seg = { text: string; className: string | null }
  const out: Seg[][] = [[]]
  const walk = (node: Root['children'][number], cls: string | null): void => {
    if (node.type === 'text') {
      const parts = node.value.split('\n')
      parts.forEach((part, i) => {
        if (i > 0) out.push([])
        if (part) out[out.length - 1].push({ text: part, className: cls })
      })
    } else if (node.type === 'element') {
      const own = Array.isArray(node.properties?.className) ? node.properties.className.join(' ') : null
      for (const child of node.children) walk(child as Root['children'][number], own ?? cls)
    }
  }
  for (const child of tree.children) walk(child, null)
  return out.map((segs, i) =>
    segs.length === 0
      ? ''
      : segs.map((s, j) =>
          s.className ? (
            <span key={`${i}-${j}`} className={s.className}>
              {s.text}
            </span>
          ) : (
            s.text
          ),
        ),
  )
}
