import { createHash } from 'node:crypto'
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  checkSvg,
  EXT_LIMITS,
  EXT_MANIFEST,
  forSource,
  inactiveContributions,
  loaderIssue,
  packStatus,
  parseJsonc,
  validateContributions,
  validateManifest,
  validatePackFiles,
} from '@pixelsky/protocol'
import type {
  ExtPackFileEntry,
  ExtPackInfo,
  ExtPackIssue,
  ExtPackManifest,
  ExtPackOptions,
  ExtPackReader,
  ExtPackSkillInfo,
  ExtPackSource,
} from '@pixelsky/protocol'

export interface LoadedPack {
  info: ExtPackInfo
  root: string
  /** 正斜杠相对路径 → 字节数；只含普通文件（符号链接不在里面，所以永远读不到、也不会被服务） */
  files: Map<string, number>
}

export interface LoadPackInput {
  key: string
  root: string
  source: ExtPackSource
  enabled: boolean
  addedAt: number
  options: ExtPackOptions
  revision: number
  appVersion: string
}

const SKIP_DIRS = new Set(['.git', 'node_modules'])

/**
 * 扩展的稳定标识，也是资源地址的主机名（所以必须是合法的小写主机名）。
 * 内置：b-<清单 id>；文件夹：f-<绝对路径规范化后 sha1 的前 12 位十六进制>，
 * 路径只在大小写不敏感的系统（win32 / darwin）上转小写，Linux 区分大小写。
 * platform 只给测试用，默认是当前系统。
 */
export function packKey(source: ExtPackSource, rootOrId: string, platform: NodeJS.Platform = process.platform): string {
  if (source === 'builtin') return `b-${rootOrId.toLowerCase()}`
  let path = platform === 'win32' ? rootOrId.replace(/\//g, '\\') : rootOrId
  if (path.length > 1) path = path.replace(/[\\/]+$/, '')
  if (platform === 'win32' || platform === 'darwin') path = path.toLowerCase()
  return `f-${createHash('sha1').update(path).digest('hex').slice(0, 12)}`
}

/** 不跟随符号链接地遍历扩展目录；符号链接记成 kind:'symlink'，超出上限就停并标 truncated */
export async function walkPack(
  root: string,
  opts: { limitFiles: number; limitBytes: number },
): Promise<{ files: ExtPackFileEntry[]; truncated: boolean }> {
  const files: ExtPackFileEntry[] = []
  let bytes = 0
  let truncated = false
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (truncated) return
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        files.push({ path: rel, size: 0, kind: 'symlink' })
      } else if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await visit(join(dir, entry.name), rel)
      } else if (entry.isFile()) {
        let size = 0
        try {
          size = (await lstat(join(dir, entry.name))).size
        } catch {
          continue
        }
        bytes += size
        if (files.length >= opts.limitFiles || bytes > opts.limitBytes) {
          truncated = true
          return
        }
        files.push({ path: rel, size, kind: 'file' })
      }
    }
  }
  await visit(root, '')
  return { files, truncated }
}

const decoder = new TextDecoder('utf-8', { fatal: true })

function readHead(file: string, max: number): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const size = Math.min(fstatSync(fd).size, max)
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, 0)
    return buf
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** 校验器用的只读视图：只认文件表里的普通文件，读不到、太大、不是 UTF-8 都返回 null */
export function packReader(root: string, files: Map<string, number>): ExtPackReader {
  return {
    exists: path => files.has(path),
    size: path => files.get(path) ?? null,
    readText(path) {
      const size = files.get(path)
      if (size === undefined || size > EXT_LIMITS.fileBytes) return null
      try {
        const text = decoder.decode(readFileSync(join(root, path)))
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
      } catch {
        return null
      }
    },
    readBytes(path, maxBytes) {
      if (!files.has(path)) return null
      const buf = readHead(join(root, path), Math.min(maxBytes, EXT_LIMITS.fileBytes))
      return buf ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : null
    },
    list: prefix => [...files.keys()].filter(path => path.startsWith(prefix)),
  }
}

function packError(code: string, zh: string, en: string, path?: string): ExtPackIssue {
  return { severity: 'error', scope: 'pack', code, message: { zh, en }, path }
}

/** 先按严格 JSON 读清单；严格读不了但带注释 / 结尾逗号能读，就读出来并给一条警告 */
function readManifest(root: string): { raw: unknown; issues: ExtPackIssue[] } | { fail: ExtPackIssue } {
  const file = join(root, EXT_MANIFEST)
  let size = 0
  try {
    const st = statSync(file)
    if (!st.isFile()) return { fail: loaderIssue('manifest.missing', { path: EXT_MANIFEST }) }
    size = st.size
  } catch {
    return { fail: loaderIssue('manifest.missing', { path: EXT_MANIFEST }) }
  }
  if (size > EXT_LIMITS.manifestBytes)
    return {
      fail: packError('manifest.parse', '清单文件超过 256 KB', 'The manifest is larger than 256 KB', EXT_MANIFEST),
    }
  let text: string
  try {
    text = decoder.decode(readFileSync(file))
  } catch {
    return {
      fail: packError('manifest.parse', '清单文件不是 UTF-8 编码', 'The manifest is not UTF-8 encoded', EXT_MANIFEST),
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    return { raw: JSON.parse(text), issues: [] }
  } catch (strict) {
    try {
      return {
        raw: parseJsonc(text),
        issues: [
          {
            severity: 'warning',
            scope: 'file',
            code: 'manifest.jsonc',
            message: {
              zh: '清单里有注释或结尾逗号，上架前要改成标准 JSON',
              en: 'The manifest has comments or trailing commas; use plain JSON before publishing',
            },
            path: EXT_MANIFEST,
            upload: 'reject',
          },
        ],
      }
    } catch {
      const detail = strict instanceof Error ? strict.message : String(strict)
      return {
        fail: packError(
          'manifest.parse',
          `清单不是合法的 JSON：${detail}`,
          `The manifest is not valid JSON: ${detail}`,
          EXT_MANIFEST,
        ),
      }
    }
  }
}

/** 技能的 frontmatter（只取 name / description 两个单行字段） */
function skillMeta(text: string): { name: string; description: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  if (!m) return null
  const field = (key: string): string => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(m[1])
    return line ? line[1].trim().replace(/^(['"])(.*)\1$/, '$2') : ''
  }
  const name = field('name')
  return name ? { name, description: field('description') } : null
}

/** 校验器没给技能信息时（或只给了一部分），按清单自己补：每个没停用的技能读一次 SKILL.md */
function fillSkills(
  manifest: ExtPackManifest,
  reader: ExtPackReader,
  have: ExtPackSkillInfo[],
  inactive: number[],
): ExtPackSkillInfo[] {
  const list = manifest.contributes?.skills
  if (!Array.isArray(list)) return have
  const out = [...have]
  list.forEach((skill, index) => {
    if (out.some(s => s.index === index) || inactive.includes(index)) return
    const base = typeof skill?.path === 'string' ? skill.path.replace(/\/+$/, '') : ''
    const text = base ? reader.readText(`${base}/SKILL.md`) : null
    const meta = text ? skillMeta(text) : null
    if (!meta) return
    out.push({
      name: meta.name,
      description: meta.description,
      engines: skill.engines && skill.engines.length > 0 ? [...skill.engines] : ['claude', 'codex'],
      index,
    })
  })
  return out.sort((a, b) => a.index - b.index)
}

const dedupe = (issues: ExtPackIssue[]): ExtPackIssue[] => {
  const seen = new Set<string>()
  return issues.filter(i => {
    const k = `${i.code}|${i.path ?? ''}|${i.contribution?.kind ?? ''}|${i.contribution?.index ?? ''}|${i.message.zh}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 内置扩展随包发行、文件多（Material 图标上千个），扫描上限放宽 */
const BUILTIN_SCAN = { limitFiles: 20_000, limitBytes: 200 * 1024 * 1024 }
const FOLDER_SCAN = { limitFiles: EXT_LIMITS.scanFiles, limitBytes: EXT_LIMITS.scanBytes }

/**
 * 加载一个扩展：清单 → 文件表 → 文件检查 → 内容检查；永远不抛错，问题都记在 info.issues 里。
 * 有 scope:'pack' 错误的扩展 status 为 error，live 为 false，贡献内容一个都不用。
 */
export async function loadPack(input: LoadPackInput): Promise<LoadedPack> {
  const { key, root, source, enabled, addedAt, options, revision, appVersion } = input
  const files = new Map<string, number>()
  const info: ExtPackInfo = {
    key,
    id: null,
    source,
    path: root,
    enabled,
    addedAt,
    revision,
    status: 'ok',
    manifest: null,
    live: false,
    inactive: {},
    issues: [],
    options,
    skills: [],
  }
  const loaded: LoadedPack = { info, root, files }
  const finish = (issues: ExtPackIssue[]): LoadedPack => {
    info.issues = dedupe(forSource(issues, source))
    info.status = packStatus(info.issues)
    info.live = enabled && info.status !== 'error'
    return loaded
  }

  const read = readManifest(root)
  if ('fail' in read) return finish([read.fail])
  const issues: ExtPackIssue[] = [...read.issues]

  let walked: { files: ExtPackFileEntry[]; truncated: boolean }
  try {
    walked = await walkPack(root, source === 'builtin' ? BUILTIN_SCAN : FOLDER_SCAN)
  } catch {
    walked = { files: [], truncated: false }
  }
  for (const f of walked.files) {
    if (f.kind === 'file') files.set(f.path, f.size)
    else issues.push(loaderIssue('files.symlink', { path: f.path }))
  }
  if (walked.truncated) issues.push(loaderIssue('files.scanLimit'))

  let manifest: ExtPackManifest | null = null
  try {
    const checked = validateManifest(read.raw, { appVersion, source })
    issues.push(...checked.issues)
    manifest = checked.manifest && typeof checked.manifest === 'object' ? checked.manifest : null
  } catch (e) {
    issues.push(packError('pack.validate', '清单检查出错', `Manifest validation failed: ${(e as Error).message}`))
  }
  info.manifest = manifest
  info.id = typeof manifest?.id === 'string' ? manifest.id : null
  if (!manifest || walked.truncated || issues.some(i => i.severity === 'error' && i.scope === 'pack'))
    return finish(issues)

  try {
    issues.push(...validatePackFiles(walked.files, manifest, { source }))
    // 内置扩展不扫 svg 内容（随包发行，已审过）
    if (source === 'folder')
      for (const [path, size] of files) {
        if (!path.toLowerCase().endsWith('.svg') || size > EXT_LIMITS.iconBytes) continue
        try {
          if (checkSvg(readFileSync(join(root, path), 'utf8')) !== null)
            issues.push(loaderIssue('svg.unsafe', { path }))
        } catch {
          // 读不到的文件按不存在处理
        }
      }
    const reader = packReader(root, files)
    const checked = validateContributions(manifest, reader, { source })
    issues.push(...checked.issues)
    info.inactive = inactiveContributions(manifest, forSource(dedupe(issues), source))
    info.skills = fillSkills(manifest, reader, checked.skills, info.inactive.skills ?? [])
  } catch (e) {
    issues.push(
      packError('pack.validate', '扩展内容检查出错', `Contribution validation failed: ${(e as Error).message}`),
    )
  }
  return finish(issues)
}

/** 给已加载的扩展追加一个问题（如重复 id）并重算状态 */
export function addPackIssue(pack: LoadedPack, issue: ExtPackIssue): void {
  const info = pack.info
  info.issues = dedupe([...info.issues, issue])
  info.status = packStatus(info.issues)
  info.live = info.enabled && info.status !== 'error'
}

/** 清单文件是否存在（addFolder 的前置检查，不读内容） */
export const hasManifest = (root: string): boolean => existsSync(join(root, EXT_MANIFEST))
