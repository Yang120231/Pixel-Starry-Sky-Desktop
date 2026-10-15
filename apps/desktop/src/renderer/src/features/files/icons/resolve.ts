import { packDir, resolvePackPath } from '@pixelsky/protocol'

// 文件图标主题（VS Code 图标主题格式）的纯查找逻辑：把 JSON 建成小写索引，按 VS Code 的顺序找图标。
// 只认 .svg / .png 图标；字体图标和路径逃出扩展目录的定义直接丢掉。不碰 window，node 测试可直接用。

export interface IconRef {
  packKey: string
  revision: number
  /** 扩展里的相对路径（已规范化） */
  path: string
}

/** 一套（深色或浅色）名字 → 图标 */
interface IconMaps {
  fileNames: Map<string, IconRef>
  fileExtensions: Map<string, IconRef>
  languageIds: Map<string, IconRef>
  folderNames: Map<string, IconRef>
  folderNamesExpanded: Map<string, IconRef>
  rootFolderNames: Map<string, IconRef>
  rootFolderNamesExpanded: Map<string, IconRef>
  file?: IconRef
  folder?: IconRef
  folderExpanded?: IconRef
  rootFolder?: IconRef
  rootFolderExpanded?: IconRef
}

export interface IconIndex {
  dark: IconMaps
  /** 主题的 light 部分：只放覆盖项，查找时先找它再找 dark */
  light: IconMaps
}

const MAP_KEYS = [
  'fileNames',
  'fileExtensions',
  'languageIds',
  'folderNames',
  'folderNamesExpanded',
  'rootFolderNames',
  'rootFolderNamesExpanded',
] as const
const SINGLE_KEYS = ['file', 'folder', 'folderExpanded', 'rootFolder', 'rootFolderExpanded'] as const

const emptyMaps = (): IconMaps => ({
  fileNames: new Map(),
  fileExtensions: new Map(),
  languageIds: new Map(),
  folderNames: new Map(),
  folderNamesExpanded: new Map(),
  rootFolderNames: new Map(),
  rootFolderNamesExpanded: new Map(),
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 图标主题 JSON → 索引；issues 是丢掉的定义（给界面 / 日志看，不抛错） */
export function buildIconIndex(
  theme: unknown,
  src: { packKey: string; revision: number; themePath: string },
): { index: IconIndex; issues: string[] } {
  const index: IconIndex = { dark: emptyMaps(), light: emptyMaps() }
  const issues: string[] = []
  if (!isRecord(theme)) return { index, issues: ['theme is not an object'] }

  const base = packDir(src.themePath)
  const refs = new Map<string, IconRef | null>()
  const defs = isRecord(theme.iconDefinitions) ? theme.iconDefinitions : {}
  for (const [id, def] of Object.entries(defs)) {
    const iconPath = isRecord(def) && typeof def.iconPath === 'string' ? def.iconPath : null
    if (iconPath === null) {
      refs.set(id, null)
      if (isRecord(def) && 'fontCharacter' in def) issues.push(`font definition dropped: ${id}`)
      continue
    }
    const path = resolvePackPath(base, iconPath)
    if (!path || !/\.(svg|png)$/i.test(path)) {
      refs.set(id, null)
      issues.push(`icon dropped: ${id}`)
      continue
    }
    refs.set(id, { packKey: src.packKey, revision: src.revision, path })
  }
  const ref = (id: unknown): IconRef | null => (typeof id === 'string' ? (refs.get(id) ?? null) : null)

  const fill = (maps: IconMaps, part: unknown): void => {
    if (!isRecord(part)) return
    for (const k of MAP_KEYS) {
      const table = part[k]
      if (!isRecord(table)) continue
      for (const [name, id] of Object.entries(table)) {
        const r = ref(id)
        if (r) maps[k].set(name.toLowerCase(), r)
      }
    }
    for (const k of SINGLE_KEYS) {
      const r = ref(part[k])
      if (r) maps[k] = r
    }
  }
  fill(index.dark, theme)
  fill(index.light, theme.light)
  return { index, issues }
}

/** 局部主题叠在底板上：partial 里有的覆盖，没有的沿用底板（不改入参） */
export function mergePartial(base: IconIndex, partial: IconIndex): IconIndex {
  const merge = (a: IconMaps, b: IconMaps): IconMaps => {
    const out = emptyMaps()
    for (const k of MAP_KEYS) out[k] = new Map([...a[k], ...b[k]])
    for (const k of SINGLE_KEYS) {
      const r = b[k] ?? a[k]
      if (r) out[k] = r
    }
    return out
  }
  return { dark: merge(base.dark, partial.dark), light: merge(base.light, partial.light) }
}

/** `a.d.ts` → ['d.ts', 'ts']：从长到短 */
function extensionCandidates(lower: string): string[] {
  const parts = lower.split('.')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    if (ext) out.push(ext)
  }
  return out
}

const order = (index: IconIndex, light: boolean): IconMaps[] => (light ? [index.light, index.dark] : [index.dark])

export function resolveFileIcon(
  index: IconIndex,
  name: string,
  opts: { light: boolean; languageId: string | null },
): IconRef | null {
  const lower = name.toLowerCase()
  const sets = order(index, opts.light)
  for (const m of sets) {
    const hit = m.fileNames.get(lower)
    if (hit) return hit
  }
  for (const ext of extensionCandidates(lower)) {
    for (const m of sets) {
      const hit = m.fileExtensions.get(ext)
      if (hit) return hit
    }
  }
  if (opts.languageId) {
    for (const m of sets) {
      const hit = m.languageIds.get(opts.languageId.toLowerCase())
      if (hit) return hit
    }
  }
  for (const m of sets) if (m.file) return m.file
  return null
}

export function resolveFolderIcon(
  index: IconIndex,
  name: string,
  opts: { light: boolean; expanded: boolean; root?: boolean },
): IconRef | null {
  const lower = name.toLowerCase()
  const sets = order(index, opts.light)
  const { expanded } = opts
  if (opts.root) {
    for (const m of sets) {
      const hit = (expanded ? m.rootFolderNamesExpanded.get(lower) : undefined) ?? m.rootFolderNames.get(lower)
      if (hit) return hit
    }
    for (const m of sets) {
      const hit = (expanded ? m.rootFolderExpanded : undefined) ?? m.rootFolder
      if (hit) return hit
    }
  }
  for (const m of sets) {
    const hit = (expanded ? m.folderNamesExpanded.get(lower) : undefined) ?? m.folderNames.get(lower)
    if (hit) return hit
  }
  for (const m of sets) {
    const hit = (expanded ? m.folderExpanded : undefined) ?? m.folder
    if (hit) return hit
  }
  return null
}
