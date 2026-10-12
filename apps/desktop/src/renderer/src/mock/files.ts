import type { DirectoryListing, FileDocument, EditorState } from '../../../shared/types/workspace'
import { SHOWCASE_FILES } from './conversations'

/** 明确标为演示的文件，仅 --demo 使用，不读写磁盘。 */
export const DEMO_FILES: Record<string, string> = {
  'README.md': '# pixel-web\n\n这是文件面板的演示内容。\n',
  // 上下文明细里的记忆文件（mock/context.ts）点得开
  'CLAUDE.md': '# pixel-web\n\n- 界面文字用中文\n- 改完跑 pnpm test\n',
  'src/session/Composer.jsx': 'export function Composer() {\n  return <textarea placeholder="描述你要做的事" />\n}\n',
  'src/styles/session.css': '.session {\n  display: flex;\n  flex-direction: column;\n}\n',
  'package.json': '{\n  "name": "pixel-web",\n  "private": true\n}\n',
  // 对话展示里提到的文件（mock/conversations.ts），路径链接和改动卡片点得开
  ...SHOWCASE_FILES,
}
export const DEMO_EDITOR_STATE: EditorState = {
  tools: [],
  workspaceId: null,
  items: [],
  defaultId: null,
  openWith: 'app',
  window: 'reuse',
  checkedAt: 0,
}
export function demoDirectory(path: string): DirectoryListing {
  const entries = new Map<string, DirectoryListing['entries'][number]>()
  const prefix = path ? path + '/' : ''
  for (const file of Object.keys(DEMO_FILES)) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length),
      name = rest.split('/')[0]
    entries.set(name, { name, path: prefix + name, kind: rest.includes('/') ? 'directory' : 'file' })
  }
  return {
    entries: [...entries.values()].sort(
      (a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name),
    ),
    truncated: false,
  }
}
export function demoDocument(path: string): FileDocument {
  if (DEMO_FILES[path] === undefined) throw new Error('演示中没有这个文件')
  return {
    kind: 'text',
    path,
    content: DEMO_FILES[path],
    version: 'demo',
    bytes: DEMO_FILES[path].length,
    bom: false,
    newline: 'lf',
  }
}
