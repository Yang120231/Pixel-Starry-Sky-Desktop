import { tr } from '../../i18n/core'
import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

const extensions: Record<string, string> = {
  ts: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  jsonc: 'JSON',
  css: 'CSS',
  html: 'HTML',
  htm: 'HTML',
  md: 'Markdown',
  markdown: 'Markdown',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  sql: 'SQL',
}
export function fileLanguage(path: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return extensions[name.split('.').pop() ?? ''] ?? tr('code.highlight.message58')
}
export async function loadLanguage(path: string): Promise<Extension> {
  switch (fileLanguage(path)) {
    case 'TypeScript':
    case 'TSX':
    case 'JavaScript':
    case 'JSX': {
      const { javascript } = await import('@codemirror/lang-javascript')
      const name = fileLanguage(path)
      return javascript({ typescript: name === 'TypeScript' || name === 'TSX', jsx: name === 'JSX' || name === 'TSX' })
    }
    case 'JSON':
      return (await import('@codemirror/lang-json')).json()
    case 'CSS':
      return (await import('@codemirror/lang-css')).css()
    case 'HTML':
      return (await import('@codemirror/lang-html')).html()
    case 'Markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'Python':
      return (await import('@codemirror/lang-python')).python()
    case 'Rust':
      return (await import('@codemirror/lang-rust')).rust()
    case 'Go':
      return (await import('@codemirror/lang-go')).go()
    case 'YAML':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'SQL':
      return (await import('@codemirror/lang-sql')).sql()
    case 'TOML':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml)
    case 'Shell':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell)
    default:
      return []
  }
}
