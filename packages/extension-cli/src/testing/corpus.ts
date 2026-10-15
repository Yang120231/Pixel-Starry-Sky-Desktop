// 共享用例（packages/protocol/corpus/extpacks）的读取、物化和归一化（plan §7）。
// 桌面的一致性测试也从 @pixelsky/extension-cli/testing 导入这里，所以只依赖协议包、folder 和 zip，不碰语法引擎。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPack, EXT_RULES_VERSION, extPackSkipped, issueOutcome } from '@pixelsky/protocol/extpacks'
import type { ExtPackCheck, ExtPackFileEntry, ExtPackFiles, ExtPackIssue } from '@pixelsky/protocol/extpacks'
import { FOLDER_SCAN } from '../lib/folder'
import { writePackZip } from '../lib/zip-write'
import { buildEntry, writeRawZip } from './raw-zip'
import type { RawZipEntry, RawZipOptions } from './raw-zip'

export type { RawZipEntry, RawZipOptions } from './raw-zip'

/** 共享用例目录（从本文件位置算，不依赖 cwd） */
export const CORPUS_DIR: string = fileURLToPath(new URL('../../../protocol/corpus/extpacks', import.meta.url))
/** 仓库根目录 */
export const REPO_ROOT: string = fileURLToPath(new URL('../../../../', import.meta.url))
/** 开发级别检查用的软件版本（用例没写 appVersion 时） */
export const DEV_APP_VERSION = '0.4.1-beta'

export type CorpusFileSpec =
  | string
  | { base64: string }
  | { json: unknown }
  | { merge: Record<string, unknown> }
  | { repeat: string; bytes: number }
  | { symlink: string }

export interface CorpusCase {
  /** 文件名去掉 .json，排序和期望文件名都用它 */
  name: string
  title: string
  /** 作者的意图：这些代码必须出现在期望里（防止生成的期望把 bug 固化下来） */
  expectCodes?: string[]
  base?: string
  input: 'folder' | 'zip'
  /** 上传级别的语法引擎模式；默认 off（off 的用例其他语言的实现也能跑） */
  grammar?: 'off' | 'regex' | 'full'
  appVersion?: string
  remove?: string[]
  files?: Record<string, CorpusFileSpec>
  generate?: Array<{ path: string; count: number; text: string }>
  zipEntries?: RawZipEntry[]
  zipOptions?: RawZipOptions
  zipBase64?: string | null
  needs?: Array<'symlink'>
}

export interface NormIssue {
  code: string
  severity: string
  scope: string
  path?: string
  contribution?: { kind: string; index: number }
  upload?: string
  pointer?: string
  outcome?: string
}

export interface CorpusExpect {
  rulesVersion: number
  dev?: {
    status: string
    inactive: Record<string, number[]>
    skills: Array<{ name: string; index: number }>
    issues: NormIssue[]
  }
  upload?: { pass: boolean; issues: NormIssue[] }
}

type TreeValue = Uint8Array | { symlink: string }
export type CaseTree = Map<string, TreeValue>

export class SymlinkUnsupported extends Error {
  constructor() {
    super('这台机器不能创建符号链接')
    this.name = 'SymlinkUnsupported'
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function listCases(): CorpusCase[] {
  const dir = join(CORPUS_DIR, 'cases')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.expect.json'))
    .sort()
    .map(f => {
      const name = f.slice(0, -'.json'.length)
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Omit<CorpusCase, 'name'>
      return { ...raw, name }
    })
}

function walkFiles(root: string, prefix: string, out: CaseTree): void {
  for (const item of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) walkFiles(root, rel, out)
    else if (item.isFile()) out.set(rel, new Uint8Array(readFileSync(join(root, rel))))
  }
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 深合并；null 删除键，数组整体替换 */
function mergeJson(target: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isRec(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (isRec(v)) out[k] = mergeJson(out[k], v)
    else out[k] = v
  }
  return out
}

function specBytes(spec: CorpusFileSpec, existing: TreeValue | undefined): TreeValue {
  if (typeof spec === 'string') return enc.encode(spec)
  if ('base64' in spec) return new Uint8Array(Buffer.from(spec.base64, 'base64'))
  if ('json' in spec) return enc.encode(`${JSON.stringify(spec.json, null, 2)}\n`)
  if ('symlink' in spec) return { symlink: spec.symlink }
  if ('merge' in spec) {
    const base = existing instanceof Uint8Array ? (JSON.parse(dec.decode(existing)) as unknown) : {}
    return enc.encode(`${JSON.stringify(mergeJson(base, spec.merge), null, 2)}\n`)
  }
  const unit = enc.encode(spec.repeat)
  const buf = new Uint8Array(spec.bytes)
  for (let i = 0; i < spec.bytes; i++) buf[i] = unit[i % unit.length]
  return buf
}

/** 用例的文件树：底板 → remove → files → generate（路径正斜杠，没有目录项） */
export function caseTree(c: CorpusCase): CaseTree {
  const tree: CaseTree = new Map()
  if (c.base) {
    const dir = join(CORPUS_DIR, 'bases', c.base)
    if (!existsSync(dir)) throw new Error(`用例 ${c.name} 的底板不存在：${c.base}`)
    walkFiles(dir, '', tree)
  }
  for (const r of c.remove ?? []) {
    for (const p of [...tree.keys()]) if (p === r || p.startsWith(r.endsWith('/') ? r : `${r}/`)) tree.delete(p)
  }
  for (const [p, spec] of Object.entries(c.files ?? {})) tree.set(p, specBytes(spec, tree.get(p)))
  for (const g of c.generate ?? []) {
    const bytes = enc.encode(g.text)
    for (let i = 0; i < g.count; i++) tree.set(g.path.replace('{i}', String(i)), bytes)
  }
  return tree
}

const byPath = (a: ExtPackFileEntry, b: ExtPackFileEntry): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/** 文件夹遍历的顺序：逐段比较（同一目录内按名字，目录里的东西紧跟在目录名的位置） */
function walkOrder(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return x.length - y.length
}

function safeRel(path: string): boolean {
  if (!path || path.includes('\\') || path.includes('\0')) return false
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

/** 内存里的 ExtPackFiles：和文件夹来源同样套用 extPackSkipped、扫描上限和排序 */
export function memoryPackFiles(c: CorpusCase): ExtPackFiles {
  const tree = caseTree(c)
  const entries: ExtPackFileEntry[] = []
  let bytes = 0
  let truncated = false
  for (const p of [...tree.keys()].sort(walkOrder)) {
    const v = tree.get(p)!
    const isLink = !(v instanceof Uint8Array)
    if (extPackSkipped(p, isLink ? 'symlink' : 'file')) continue
    const size = isLink ? 0 : v.length
    if (!isLink) {
      bytes += size
      if (entries.length >= FOLDER_SCAN.limitFiles || bytes > FOLDER_SCAN.limitBytes) {
        truncated = true
        break
      }
    }
    entries.push({ path: p, size, kind: isLink ? 'symlink' : 'file' })
  }
  entries.sort(byPath)
  return {
    entries,
    truncated,
    stat(path) {
      const v = safeRel(path) ? tree.get(path) : undefined
      return v instanceof Uint8Array ? v.length : null
    },
    read(path, maxBytes) {
      const v = safeRel(path) ? tree.get(path) : undefined
      return v instanceof Uint8Array ? v.subarray(0, Math.max(0, maxBytes)) : null
    },
  }
}

/** 这台机器（这个目录）能不能创建符号链接 */
export function canSymlink(dir: string): boolean {
  const probe = join(dir, `.symlink-probe-${process.pid}`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${probe}.target`, 'x')
    symlinkSync(`${probe}.target`, probe, 'file')
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { force: true })
    rmSync(`${probe}.target`, { force: true })
  }
}

/** 把用例写成磁盘上的文件夹（包括会被略过的文件）；返回根目录 */
export function materializeFolder(c: CorpusCase, into: string): string {
  const root = join(into, c.name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  for (const [p, v] of caseTree(c)) {
    const file = join(root, p)
    mkdirSync(dirname(file), { recursive: true })
    if (v instanceof Uint8Array) writeFileSync(file, v)
    else {
      try {
        symlinkSync(v.symlink, file, 'file')
      } catch {
        throw new SymlinkUnsupported()
      }
    }
  }
  return root
}

/** 用例对应的 zip 字节（zipBase64 → 原样；zipEntries → 文件树 + 手写条目；否则用 writePackZip 打文件树） */
export function caseZipBytes(c: CorpusCase): Uint8Array {
  if (c.zipBase64) return new Uint8Array(Buffer.from(c.zipBase64, 'base64'))
  const tree = caseTree(c)
  // zip 输入不套用略过列表（作者自己打的包里有什么就是什么）；文件夹用例转成 zip 时则和 pack 一样先略过
  const names = [...tree.keys()].filter(p => c.input === 'zip' || !extPackSkipped(p, 'file'))
  const rawOf = (p: string): RawZipEntry => {
    const v = tree.get(p)!
    return v instanceof Uint8Array
      ? { name: p, base64: Buffer.from(v).toString('base64') }
      : { name: p, symlink: v.symlink }
  }
  if (c.zipEntries || c.zipOptions) {
    return writeRawZip([...names.map(rawOf), ...(c.zipEntries ?? [])].map(buildEntry), c.zipOptions)
  }
  const files = names.filter(p => tree.get(p) instanceof Uint8Array)
  const src: ExtPackFiles = {
    entries: files.map(p => ({ path: p, size: (tree.get(p) as Uint8Array).length, kind: 'file' as const })),
    truncated: false,
    stat: p => (tree.get(p) instanceof Uint8Array ? (tree.get(p) as Uint8Array).length : null),
    read: (p, max) => {
      const v = tree.get(p)
      return v instanceof Uint8Array ? v.subarray(0, max) : null
    },
  }
  return writePackZip(src, files)
}

/** 问题的归一化形式：不含文字和行列，按 JSON 串排序后可当多重集比较 */
export function normalizeIssues(issues: ExtPackIssue[], withOutcome: boolean): NormIssue[] {
  const out = issues.map(i => {
    const n: NormIssue = { code: i.code, severity: i.severity, scope: i.scope }
    if (i.path !== undefined) n.path = i.path
    if (i.contribution !== undefined) n.contribution = { kind: i.contribution.kind, index: i.contribution.index }
    if (i.upload !== undefined) n.upload = i.upload
    if (i.loc?.pointer !== undefined) n.pointer = i.loc.pointer
    if (withOutcome) n.outcome = issueOutcome(i)
    return n
  })
  return out.sort((a, b) => {
    const x = JSON.stringify(a)
    const y = JSON.stringify(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
}

/** 开发级别（和桌面一致）的归一化结果 */
export function normalizeDev(check: ExtPackCheck): NonNullable<CorpusExpect['dev']> {
  const inactive: Record<string, number[]> = {}
  for (const [k, v] of Object.entries(check.inactive)) if (v && v.length > 0) inactive[k] = [...v]
  return {
    status: check.status,
    inactive,
    skills: check.skills.map(s => ({ name: s.name, index: s.index })),
    issues: normalizeIssues(check.issues, false),
  }
}

/** 开发级别的检查：和桌面 loadPack 一样，内存来源 + appVersion */
export function devCheck(c: CorpusCase): ExtPackCheck {
  return checkPack(memoryPackFiles(c), { source: 'folder', appVersion: c.appVersion ?? DEV_APP_VERSION })
}

const expectPath = (c: CorpusCase): string => join(CORPUS_DIR, 'cases', `${c.name}.expect.json`)

export function expectOf(c: CorpusCase): CorpusExpect | null {
  const file = expectPath(c)
  if (!existsSync(file) || !statSync(file).isFile()) return null
  return JSON.parse(readFileSync(file, 'utf8')) as CorpusExpect
}

/** 只有 CORPUS_UPDATE=1 时才写；写出前把版本号补上 */
export function writeExpect(c: CorpusCase, e: Omit<CorpusExpect, 'rulesVersion'>): void {
  if (process.env.CORPUS_UPDATE !== '1') throw new Error('writeExpect 只在 CORPUS_UPDATE=1 时可用')
  const full: CorpusExpect = { rulesVersion: EXT_RULES_VERSION, ...e }
  writeFileSync(expectPath(c), `${JSON.stringify(full, null, 2)}\n`)
}
