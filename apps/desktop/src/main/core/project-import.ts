// 只提取各工具明确保存的本机项目路径，不扫描聊天正文、不执行来源工具。
import { access, open, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { ProjectImportBatch, ProjectImportCandidate, ProjectImportTool } from '../../shared/types/project-import'

export const MAX_IMPORT_PATHS = 10_000
const MAX_FILE_BYTES = 32 * 1024 * 1024
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strings = (v: unknown): string[] => array(v).filter((p): p is string => typeof p === 'string')
const key = (path: string): string => (process.platform === 'win32' ? path.toLowerCase() : path)

/** 文件句柄固定读取对象；不把 JSON 解析错误里的配置片段回传给界面。 */
export async function readImportFile(file: string): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('项目清单不是文件或超过 32 MB')
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_FILE_BYTES + 1))
    let size = 0
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > MAX_FILE_BYTES) throw new Error('项目清单超过 32 MB')
    return buffer
      .subarray(0, size)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
  } finally {
    await handle.close()
  }
}

async function json(file: string): Promise<Record<string, unknown>> {
  try {
    return object(JSON.parse(await readImportFile(file)))
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('项目清单 JSON 格式不正确')
    throw e
  }
}

export function parsePathList(text: string): string[] {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('项目路径清单过大')
  const value = text.replace(/^\uFEFF/, '').trim()
  if (!value) return []
  if (value.startsWith('[')) {
    let list: unknown
    try {
      list = JSON.parse(value)
    } catch {
      throw new Error('路径清单 JSON 格式不正确，请使用字符串数组')
    }
    if (!Array.isArray(list) || list.some(p => typeof p !== 'string')) throw new Error('路径清单需要是 JSON 字符串数组')
    if (list.length > MAX_IMPORT_PATHS) throw new Error('一次最多导入 10000 个项目路径')
    return list as string[]
  }
  const paths = value
    .split(/\r?\n/)
    .map(p => p.trim())
    .filter(Boolean)
  if (paths.length > MAX_IMPORT_PATHS) throw new Error('一次最多导入 10000 个项目路径')
  return paths
}

export function toolProjectPaths(tool: ProjectImportTool, value: unknown): string[] {
  const data = object(value)
  switch (tool) {
    case 'claude':
      return Object.keys(object(data.projects))
    case 'codex': {
      const projects = Object.values(object(data['local-projects']))
      return [
        ...projects.flatMap(p => strings(object(p).rootPaths)),
        ...strings(data['electron-saved-workspace-roots']),
      ]
    }
    case 'zcode':
      return [
        ...strings(data.recentProjects),
        ...strings(data.lastOpenTabs),
        ...array(data.lastWorkspaceSession).flatMap(entry => {
          const e = object(entry)
          return e.kind === 'local' && e.workspacePurpose !== 'conversation' && typeof e.workspacePath === 'string'
            ? [e.workspacePath]
            : []
        }),
      ]
    case 'kimi': {
      const deleted = new Set(strings(data.deleted_workspace_ids))
      return [
        ...Object.entries(object(data.workspaces)).flatMap(([id, value]) => {
          const e = object(value)
          return !deleted.has(id) && typeof e.root === 'string' ? [e.root] : []
        }),
        ...array(data.work_dirs).flatMap(value => {
          const e = object(value)
          return (e.kaos === undefined || e.kaos === 'local') && typeof e.path === 'string' ? [e.path] : []
        }),
      ]
    }
  }
}

export interface ImportPath {
  path: string
  source: string
  /** 直接选择或平台记录默认选中；扫描父文件夹时沿用项目标记。 */
  project?: boolean
}

/** 分组读取目录，避免大清单一次耗尽文件句柄；无效目录保留在预览里。 */
export async function inspectProjectPaths(
  paths: readonly ImportPath[],
  known: readonly string[],
): Promise<ProjectImportBatch> {
  if (paths.length > MAX_IMPORT_PATHS) throw new Error('一次最多导入 10000 个项目路径')
  const knownKeys = new Set(await Promise.all(known.map(async p => key(await realpath(p).catch(() => resolve(p))))))
  const candidates = new Map<string, ProjectImportCandidate>()
  for (let start = 0; start < paths.length; start += 32) {
    const batch = await Promise.all(
      paths.slice(start, start + 32).map(async input => {
        let path = input.path.trim()
        if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))
          path = path.slice(1, -1)
        if (path.startsWith('file:')) {
          try {
            path = fileURLToPath(path)
          } catch {
            /* 在下面标为无效路径 */
          }
        }
        const c: ProjectImportCandidate = {
          path,
          name: basename(path) || path,
          sources: [input.source],
          project: input.project !== false,
          added: false,
        }
        // Windows 的 /tmp、C:relative、\root 不能当作本机完整路径。
        const absolute =
          process.platform === 'win32' ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(path) : isAbsolute(path)
        if (!absolute || path.length > 4096 || /[\r\n\0]/.test(path)) return { ...c, issue: 'invalid' as const }
        try {
          c.path = await realpath(path)
          c.name = basename(c.path) || c.path
          if (!(await stat(c.path)).isDirectory()) c.issue = 'notDirectory'
          else await access(c.path, constants.R_OK | constants.X_OK)
        } catch (e) {
          c.path = resolve(path)
          c.issue = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable'
        }
        c.added = knownKeys.has(key(c.path))
        return c
      }),
    )
    for (const c of batch) {
      const id = key(c.path),
        previous = candidates.get(id)
      if (previous) {
        previous.sources = [...new Set([...previous.sources, ...c.sources])]
        previous.project ||= c.project
      } else candidates.set(id, c)
    }
  }
  return { candidates: [...candidates.values()], warnings: [] }
}

export function toolImportFiles(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Record<ProjectImportTool, string[]> {
  const zhome = env.ZCODE_DESKTOP_HOME_DIR || env.HOME || home
  return {
    claude: [env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json')],
    codex: [join(env.CODEX_HOME || join(home, '.codex'), '.codex-global-state.json')],
    zcode: [join(zhome, '.zcode', 'v2', 'setting.json')],
    kimi: [
      join(env.KIMI_CODE_HOME || join(home, '.kimi-code'), 'workspaces.json'),
      join(env.KIMI_SHARE_DIR || join(home, '.kimi'), 'kimi.json'),
    ],
  }
}

/** 只读 ZCode 任务索引，补齐最近项目（上游只保留 10 个）以外的本机路径。 */
export function zcodeIndexPaths(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false })
  try {
    return db
      .prepare(
        `SELECT DISTINCT workspace_path FROM tasks
      WHERE deleted = 0 AND workspace_key NOT LIKE 'remote:%'
        AND COALESCE(workspace_identity, '') NOT LIKE 'remote:%'
      LIMIT ${MAX_IMPORT_PATHS + 1}`,
      )
      .all()
      .map(row => String(row.workspace_path))
      .filter(path => !/[\\/]\.zcode[\\/]workspace[\\/]default[\\/]?$/i.test(path))
  } finally {
    db.close()
  }
}

function zcodeIndexFile(file: string, data: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const base = env.ZCODE_DATA_BASE_DIR || (typeof data.dataBaseDir === 'string' ? data.dataBaseDir : undefined)
  return base ? join(base, '.zcode', 'v2', 'tasks-index.sqlite') : join(dirname(file), 'tasks-index.sqlite')
}

export async function readToolProjects(
  tool: ProjectImportTool,
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ paths: ImportPath[]; warnings: string[] }> {
  const warnings: string[] = []
  if (tool === 'zcode' && /\.(sqlite|db)$/i.test(file))
    return { paths: zcodeIndexPaths(file).map(path => ({ path, source: 'Z Code' })), warnings }
  const data = await json(file)
  const source = { claude: 'Claude Code', codex: 'Codex', zcode: 'Z Code', kimi: 'Kimi Code' }[tool]
  const paths = toolProjectPaths(tool, data).map(path => ({ path, source }))
  if (tool === 'zcode') {
    const index = zcodeIndexFile(file, data, env)
    try {
      await access(index)
      paths.push(...zcodeIndexPaths(index).map(path => ({ path, source })))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('Z Code：任务索引无法读取，已保留设置中的项目')
    }
  }
  return { paths, warnings }
}

export async function discoverToolProjects(
  known: readonly string[],
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProjectImportBatch> {
  const paths: ImportPath[] = [],
    warnings: string[] = []
  for (const [tool, files] of Object.entries(toolImportFiles(home, env)) as Array<[ProjectImportTool, string[]]>) {
    for (const file of files) {
      try {
        const result = await readToolProjects(tool, file, env)
        paths.push(...result.paths)
        warnings.push(...result.warnings)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
          warnings.push(`${tool}：项目清单无法读取，可手动选择清单或项目文件夹`)
        // 设置缺失或损坏时仍尝试独立的任务索引；不创建、迁移或修复来源文件。
        if (tool === 'zcode') {
          try {
            const index = zcodeIndexFile(file, {}, env)
            await access(index)
            paths.push(...zcodeIndexPaths(index).map(path => ({ path, source: 'Z Code' })))
          } catch (indexError) {
            if ((indexError as NodeJS.ErrnoException).code !== 'ENOENT')
              warnings.push('Z Code：任务索引无法读取，可手动选择清单或项目文件夹')
          }
        }
      }
    }
  }
  const unique = new Map<string, ImportPath>()
  // inspectProjectPaths 再按实际路径合并；此处只限制读取规模。
  for (const p of paths) unique.set(key(p.path) + '\0' + p.source, p)
  if (unique.size > MAX_IMPORT_PATHS) warnings.push('项目过多，仅预览前 10000 个路径，请分批导入')
  const result = await inspectProjectPaths([...unique.values()].slice(0, MAX_IMPORT_PATHS), known)
  return { ...result, warnings }
}
