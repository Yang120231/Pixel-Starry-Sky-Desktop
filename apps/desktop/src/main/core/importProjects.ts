// 「从一个文件夹导入…」（docs/ui/multi-root-projects.md §2）：列出上级文件夹下的子文件夹，标出哪些像项目、哪些已经在列表里
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ImportCandidates } from '../../shared/types/workspace'

/** 子文件夹里有这些之一就算「像项目」 */
const MARKERS = new Set([
  '.git',
  'package.json',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'composer.json',
  'Gemfile',
  'CMakeLists.txt',
  'Makefile',
  'deno.json',
  'pubspec.yaml',
  '.project',
])
const MARKER_EXT = /\.(sln|csproj|xcodeproj|xcworkspace)$/i
/** 不列的子文件夹：依赖、构建产物、系统目录 */
const SKIP = new Set(['node_modules', '$RECYCLE.BIN', 'System Volume Information', '__pycache__'])
/** 一次最多列这么多个 */
export const MAX_CANDIDATES = 500

const looksLikeProject = (names: readonly string[]): boolean =>
  names.some(name => MARKERS.has(name) || MARKER_EXT.test(name))

/**
 * 列出 parent 下一层的子文件夹（不往下翻），按名字排。
 * key：比较路径用的（Windows 不分大小写）；known：已经是项目的路径
 */
export async function listImportCandidates(
  parent: string,
  known: readonly string[],
  key: (path: string) => string = path => (process.platform === 'win32' ? path.toLowerCase() : path),
): Promise<ImportCandidates> {
  const root = resolve(parent)
  const added = new Set(known.map(path => key(resolve(path))))
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b))
  const candidates = await Promise.all(
    entries.slice(0, MAX_CANDIDATES).map(async name => {
      const path = join(root, name)
      // 读不了的子文件夹（没权限）照样列出，只是不算像项目
      const names = await readdir(path).catch(() => [] as string[])
      return { name, path, project: looksLikeProject(names), added: added.has(key(path)) }
    }),
  )
  return { parent: root, candidates, truncated: entries.length > MAX_CANDIDATES }
}
