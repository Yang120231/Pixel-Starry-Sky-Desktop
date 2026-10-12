// 代码高亮（docs/mobile-remote.md §17 第 5 项）：和桌面 ui/code/highlight.tsx 一样用 lowlight（highlight.js 的
// 37 种常用语言）+ 设计变量 --syn-* 着色，转成 React 元素、不拼 HTML。高亮库按需加载：第一次遇到代码块才下载，
// 先按纯文字显示，加载好后换成着色的（不让首屏变大）。packages/ui 抽出后换成共用的。
import type { ReactNode } from 'react'

/** 代码块标注的语言名 → highlight.js 认得的名字（大多数别名 highlight.js 自己就认） */
export const ALIASES: Record<string, string> = {
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

/** 太长的不高亮（highlight.js 是同步的，手机上更容易卡） */
export const MAX_LENGTH = 50_000

export type Highlighter = (code: string, lang: string | null) => ReactNode

let ready: Highlighter | null = null
let loading: Promise<Highlighter> | null = null

/** 已经加载好的高亮函数；还没加载时为 null */
export const loadedHighlighter = (): Highlighter | null => ready

export function loadHighlighter(): Promise<Highlighter> {
  // 整个模块单独成一块：在那个模块里静态导入 common，打包时才能去掉用不到的 all（190 种语言）
  loading ??= import('./highlighter').then(({ createHighlighter }) => (ready = createHighlighter()))
  return loading
}
