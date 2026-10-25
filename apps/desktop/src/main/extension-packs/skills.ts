import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ExtPackSkillInfo, SkillCommand } from '@pixelsky/protocol'
import type { LoadedPack } from './loader'
import { removeTree } from '@pixelsky/engine'

type Engine = 'claude' | 'codex' | 'pixel'

/** Claude 插件清单里的 name（稳定，技能命令就叫 <这个名字>:<技能名>） */
export function claudePluginName(packId: string): string {
  return 'ext-' + packId.replace('.', '-')
}

/**
 * 这个扩展给某个引擎用的、没被停用的技能（扩展没生效就一个都没有）。
 * 清单里技能只能写 claude / codex；像素星空（Pi 和它们一样认 SKILL.md 目录）拿两个都写了的——没写 engines 的默认就是两个都给；
 * 只给其中一个的多半写了那个工具特有的东西，不给它
 */
export function activeSkills(pack: LoadedPack, engine: Engine): ExtPackSkillInfo[] {
  if (!pack.info.live) return []
  const off = pack.info.inactive.skills ?? []
  const forEngine = (s: ExtPackSkillInfo): boolean =>
    engine === 'pixel' ? s.engines.includes('claude') && s.engines.includes('codex') : s.engines.includes(engine)
  return pack.info.skills.filter(s => forEngine(s) && !off.includes(s.index))
}

/** 技能文件夹在扩展里的相对路径（去掉结尾斜杠） */
function skillPath(pack: LoadedPack, skill: ExtPackSkillInfo): string {
  const p = pack.info.manifest?.contributes.skills?.[skill.index]?.path ?? ''
  return p.replace(/\/+$/, '')
}

const COPY_EXT = /\.(md|png|svg|jpe?g|gif|webp)$/i
const COPY_FILES = 200
const COPY_BYTES = 2 * 1024 * 1024

/** 会被复制进包装目录的文件：[扩展内相对路径, 所属技能名, 技能目录相对路径]（writeWrapper 和指纹共用） */
function wrapperFiles(pack: LoadedPack): { skill: string; base: string; path: string }[] {
  const out: { skill: string; base: string; path: string }[] = []
  for (const skill of activeSkills(pack, 'claude')) {
    const base = skillPath(pack, skill)
    let count = 0
    for (const [path, size] of pack.files) {
      if (!path.startsWith(base + '/') || !COPY_EXT.test(path) || size > COPY_BYTES) continue
      if (++count > COPY_FILES) break
      out.push({ skill: skill.name, base, path })
    }
  }
  return out
}

const fingerprints = new WeakMap<LoadedPack, string>()

/** 要复制的文件的 路径 + 大小 + 修改时间（每个扩展实例只算一次，保证同一实例的目录名稳定） */
function contentFingerprint(pack: LoadedPack): string {
  let fp = fingerprints.get(pack)
  if (fp === undefined) {
    fp = wrapperFiles(pack)
      .map(f => {
        try {
          const st = statSync(join(pack.root, f.path))
          return `${f.path}:${st.size}:${st.mtimeMs}`
        } catch {
          return `${f.path}:?`
        }
      })
      .join('\n')
    fingerprints.set(pack, fp)
  }
  return fp
}

/** 目录名：扩展 key、版本、技能名和路径，加上要复制的文件的指纹（路径 / 大小 / 修改时间，不读内容），任何一个变了名字就变；所以已有的目录永远不用改 */
export function wrapperDirName(pack: LoadedPack): string {
  const skills = activeSkills(pack, 'claude')
    .map(s => `${s.name}=${skillPath(pack, s)}`)
    .join('\n')
  const hash = createHash('sha1')
    .update(`${pack.info.key}|${pack.info.revision}|${skills}|${contentFingerprint(pack)}`)
    .digest('hex')
    .slice(0, 8)
  return `${claudePluginName(pack.info.id ?? pack.info.key)}-${hash}`
}

let tmpCounter = 0

async function writeWrapper(pack: LoadedPack, dir: string): Promise<void> {
  const tmp = `${dir}.tmp-${process.pid}-${++tmpCounter}`
  try {
    await rm(tmp, { recursive: true, force: true })
    await mkdir(join(tmp, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(tmp, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: claudePluginName(pack.info.id ?? pack.info.key),
        description: 'PixelSky extension skills',
      }),
      'utf8',
    )
    for (const f of wrapperFiles(pack)) {
      const target = join(tmp, 'skills', f.skill, f.path.slice(f.base.length + 1))
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(pack.root, f.path), target)
    }
    try {
      await rename(tmp, dir)
    } catch (e) {
      // 别处刚好建好了同名目录：用它，丢掉临时的
      if (!existsSync(dir)) throw e
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * 给每个“有 Claude 技能”的生效扩展建好 <runtimeDir>/claude/<wrapperDirName>/（缺才建，先写临时目录再改名），
 * 返回 扩展 key → 插件目录。永远不删、不改已有目录：正在跑的会话可能还在用。
 */
export async function ensureClaudeWrappers(runtimeDir: string, packs: LoadedPack[]): Promise<Map<string, string>> {
  const wrappers = new Map<string, string>()
  const root = join(runtimeDir, 'claude')
  for (const pack of packs) {
    if (activeSkills(pack, 'claude').length === 0) continue
    const dir = join(root, wrapperDirName(pack))
    try {
      if (!existsSync(dir)) {
        mkdirSync(root, { recursive: true })
        await writeWrapper(pack, dir)
      }
      wrappers.set(pack.info.key, dir)
    } catch {
      // 这个扩展的技能这次不可用；其它扩展照常
    }
  }
  return wrappers
}

/** 只在 start() 里、任何会话启动之前调用：清空 <runtimeDir>/claude；删不掉的（被占用）留到下次启动 */
export function gcClaudeWrappers(runtimeDir: string): void {
  const root = join(runtimeDir, 'claude')
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    try {
      removeTree(join(root, name))
    } catch {
      // EBUSY / EPERM：留着
    }
  }
}

/**
 * 某个引擎的技能启动信息；key 只含“对这个引擎有技能的生效扩展”，没有时是 ''（图标包 / 主题开关不会让会话重启）。
 * Claude 走生成的插件目录；Codex 和像素星空直接给技能目录（像素星空每个目录一个 --skill，engine pixel/session.ts）
 */
export function packSkillLaunch(
  packs: LoadedPack[],
  wrappers: Map<string, string>,
  engine: Engine,
): { key: string; pluginDirs: string[]; skillRoots: string[] } {
  if (engine === 'claude') {
    const used = packs.filter(p => activeSkills(p, 'claude').length > 0 && wrappers.has(p.info.key))
    if (used.length === 0) return { key: '', pluginDirs: [], skillRoots: [] }
    return {
      key: JSON.stringify(used.map(p => [p.info.key, wrapperDirName(p)])),
      pluginDirs: used.map(p => wrappers.get(p.info.key)!),
      skillRoots: [],
    }
  }
  const entries = packs
    .map(p => ({
      pack: p,
      roots: activeSkills(p, engine).map(s => join(p.root, skillPath(p, s))),
    }))
    .filter(e => e.roots.length > 0)
  if (entries.length === 0) return { key: '', pluginDirs: [], skillRoots: [] }
  return {
    key: JSON.stringify(entries.map(e => [e.pack.info.key, e.pack.info.revision, e.roots])),
    pluginDirs: [],
    skillRoots: entries.flatMap(e => e.roots),
  }
}

/** 输入框里 / 菜单用的技能命令：<插件名>:<技能名>，只含 Claude 能用的 */
export function packSkillCommands(packs: LoadedPack[]): SkillCommand[] {
  const commands: SkillCommand[] = []
  for (const pack of packs)
    for (const skill of activeSkills(pack, 'claude'))
      commands.push({
        name: `${claudePluginName(pack.info.id ?? pack.info.key)}:${skill.name}`,
        description: skill.description,
        source: 'configured',
      })
  return commands
}
