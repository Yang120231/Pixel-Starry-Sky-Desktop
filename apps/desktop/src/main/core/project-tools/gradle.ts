// 代码模式左栏「任务」的 Gradle 部分（docs/ui/coding-tasks.md §9.1）：只读 settings / build / gradle.properties，不执行 Gradle
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import type { GradleListedTask, GradleProperty, RunTask, RunTaskGroup } from '../../../shared/types/project-tools'

const MAX_SUBPROJECTS = 50
const MAX_PROPERTIES = 100
const SETTINGS_FILES = ['settings.gradle.kts', 'settings.gradle']
const BUILD_FILES = ['build.gradle.kts', 'build.gradle']

export type GradleReader = (path: string) => Promise<string | null>

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------

/** 去掉 // 和 /* *\/ 注释（字符串里的不动），换行保留，行号不变 */
export function stripComments(text: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === quote || c === '\n') quote = null
    } else if (c === '"' || c === "'") {
      quote = c
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      i--
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      for (let j = i; j < stop; j++) if (text[j] === '\n') out += '\n'
      i = stop - 1
    } else out += c
  }
  return out
}

/** 去掉注释后的源码，带花括号深度和行号查询 */
interface Source {
  text: string
  /** depth[i]：第 i 个字符之前没闭合的 { 个数 */
  depth: Int32Array
  lineAt(index: number): number
}

function analyze(raw: string): Source {
  const text = stripComments(raw)
  const depth = new Int32Array(text.length + 1)
  const starts = [0]
  let level = 0
  for (let i = 0; i < text.length; i++) {
    depth[i] = level
    const c = text.charCodeAt(i)
    if (c === 123) level++
    else if (c === 125 && level > 0) level--
    else if (c === 10) starts.push(i + 1)
  }
  depth[text.length] = level
  return {
    text,
    depth,
    lineAt(index) {
      let lo = 0
      let hi = starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid] <= index) lo = mid
        else hi = mid - 1
      }
      return lo + 1
    },
  }
}

/** open 是 `{` 的位置，返回配对的 `}` 位置；没配上返回文本末尾 */
function blockEnd(src: Source, open: number): number {
  const target = src.depth[open]
  for (let i = open + 1; i < src.text.length; i++) if (src.depth[i] === target) return i - 1
  return src.text.length
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export interface GradleSettings {
  /** rootProject.name；没写 null */
  rootName: string | null
  /** include 的项目路径（':a'、':libs:core'），去重，按出现顺序 */
  includes: string[]
  /** projectDir 覆盖：项目路径 → 相对构建根目录的文件夹（posix） */
  dirs: Record<string, string>
}

function projectPath(name: string): string {
  const parts = name.split(':').filter(Boolean)
  return parts.length ? ':' + parts.join(':') : ':'
}

export function parseSettings(raw: string): GradleSettings {
  const src = analyze(raw)
  const text = src.text
  const name = /rootProject\s*\.\s*name\s*=\s*['"]([^'"]+)['"]/.exec(text)
  const includes: string[] = []
  const include = /(?<![\w.])include\b\s*(\()?/g
  for (let m = include.exec(text); m; m = include.exec(text)) {
    const from = m.index + m[0].length
    let to: number
    if (m[1]) {
      // include(":a", ":b")，可以跨行
      const close = text.indexOf(')', from)
      to = close < 0 ? text.length : close
    } else {
      // include ':a', ':b'：逗号结尾时下一行接着算
      to = from
      for (;;) {
        const eol = text.indexOf('\n', to)
        const end = eol < 0 ? text.length : eol
        if (!/,\s*$/.test(text.slice(to, end)) || eol < 0) {
          to = end
          break
        }
        to = eol + 1
      }
    }
    const chunk = text.slice(from, to)
    for (const s of chunk.matchAll(/['"]([^'"]+)['"]/g)) {
      const path = projectPath(s[1])
      if (path !== ':' && !includes.includes(path)) includes.push(path)
    }
  }
  const dirs: Record<string, string> = {}
  const dirRe =
    /project\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*projectDir\s*=\s*(?:file\s*\(\s*|new\s+File\s*\(\s*settingsDir\s*,\s*)['"]([^'"]+)['"]/g
  for (const m of text.matchAll(dirRe)) {
    const dir = posix.normalize(m[2].replace(/\\/g, '/')).replace(/\/$/, '')
    // 跑到构建目录外面去的不认
    if (dir === '..' || dir.startsWith('../') || posix.isAbsolute(dir) || /^[a-zA-Z]:/.test(dir)) continue
    dirs[projectPath(m[1])] = dir === '.' ? '' : dir
  }
  return { rootName: name ? name[1] : null, includes, dirs }
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

export type GradlePlugin =
  | 'fabric-loom'
  | 'architectury-loom'
  | 'moddev'
  | 'neogradle'
  | 'forgegradle'
  | 'spring-boot'
  | 'android-app'
  | 'android-lib'
  | 'kotlin-jvm'
  | 'kotlin'
  | 'application'
  | 'java-library'
  | 'java'
  | 'groovy'
  | 'war'
  | 'maven-publish'

/** 主插件显示名，按这个顺序取第一个 */
const MAIN_PLUGINS: [GradlePlugin | GradlePlugin[], string][] = [
  ['fabric-loom', 'Fabric Loom'],
  ['architectury-loom', 'Architectury Loom'],
  ['moddev', 'ModDevGradle'],
  ['neogradle', 'NeoGradle'],
  ['forgegradle', 'ForgeGradle'],
  ['spring-boot', 'Spring Boot'],
  [['android-app', 'android-lib'], 'Android'],
  [['kotlin-jvm', 'kotlin'], 'Kotlin'],
  ['application', 'application'],
  ['java-library', 'java-library'],
  ['java', 'java'],
  ['groovy', 'groovy'],
]
/** 带 JVM 编译的插件（有 jar / classes / test / javadoc） */
const JAVA_PLUGINS: GradlePlugin[] = [
  'java',
  'java-library',
  'application',
  'kotlin-jvm',
  'groovy',
  'spring-boot',
  'fabric-loom',
  'architectury-loom',
  'moddev',
  'neogradle',
  'forgegradle',
]

function classifyPlugin(id: string): GradlePlugin | null {
  const n = id.toLowerCase().replace(/[-_]/g, '.')
  if (/fabric\.loom/.test(n)) return 'fabric-loom'
  if (/architectury/.test(n)) return 'architectury-loom'
  if (/moddev/.test(n)) return 'moddev'
  if (/neogradle|neoforged\.gradle/.test(n)) return 'neogradle'
  if (/forgegradle|minecraftforge\.gradle/.test(n)) return 'forgegradle'
  if (/spring(framework)?\.boot/.test(n)) return 'spring-boot'
  if (/android\.application/.test(n)) return 'android-app'
  if (/android\.library/.test(n)) return 'android-lib'
  if (/kotlin\.(plugin|kapt|ksp|serialization)/.test(n)) return null
  if (/kotlin\.jvm/.test(n)) return 'kotlin-jvm'
  if (/kotlin/.test(n)) return 'kotlin'
  if (n === 'java.library') return 'java-library'
  if (n === 'java') return 'java'
  if (n === 'application') return 'application'
  if (n === 'groovy') return 'groovy'
  if (n === 'war') return 'war'
  if (n === 'maven.publish') return 'maven-publish'
  return null
}

export interface DetectedPlugins {
  /** 认得的插件 */
  keys: Set<GradlePlugin>
  /** 写了任何插件（包括不认得的） */
  any: boolean
}

/** 找 plugins {} / apply plugin 里的插件：`id 'x'`、`id("x")`、`java`、`` `java-library` ``、`kotlin("jvm")`、`alias(libs.plugins.x)` */
export function detectPlugins(raw: string | Source): DetectedPlugins {
  const src = typeof raw === 'string' ? analyze(raw) : raw
  const text = src.text
  const ids: string[] = []
  for (const m of text.matchAll(/(?<![\w.])id\s*\(?\s*['"]([^'"]+)['"]/g)) ids.push(m[1])
  for (const m of text.matchAll(/(?<![\w.])apply\s*\(?\s*plugin\s*[:=]\s*['"]([^'"]+)['"]/g)) ids.push(m[1])
  for (const m of text.matchAll(/(?<![\w.])kotlin\s*\(\s*['"]([\w-]+)['"]\s*\)/g)) ids.push('kotlin.' + m[1])
  for (const m of text.matchAll(/(?<![\w.])alias\s*\(?\s*\w+\.plugins\.([\w.-]+)/g)) ids.push(m[1])
  // 顶层 plugins { java; `maven-publish` } 里的裸名字
  for (const m of text.matchAll(/(?<![\w.])plugins\s*\{/g)) {
    const open = m.index + m[0].length - 1
    if (src.depth[open] !== 0) continue
    const inner = text.slice(open + 1, blockEnd(src, open))
    for (const part of inner.split(/[\n;]/)) {
      const bare = /^\s*`?([\w-]+)`?\s*(?:(?:version|apply)\b.*)?$/.exec(part)
      if (bare && bare[1] !== 'id' && bare[1] !== 'alias') ids.push(bare[1])
    }
  }
  const keys = new Set<GradlePlugin>()
  for (const id of ids) {
    const key = classifyPlugin(id)
    if (key) keys.add(key)
  }
  return { keys, any: ids.length > 0 }
}

export function mainPlugin(keys: Set<GradlePlugin>): string | null {
  for (const [wanted, label] of MAIN_PLUGINS) {
    if ((Array.isArray(wanted) ? wanted : [wanted]).some(k => keys.has(k))) return label
  }
  return null
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

interface Run {
  name: string
  line: number
}

const RUN_SKIP = new Set(['if', 'else', 'for', 'while', 'try', 'finally', 'when', 'all', 'each', 'configureEach'])

/** `runs { client { } create("datagen") { } register("x") named("y") }` → 每一项的名字和行号 */
export function parseRuns(raw: string | Source): Run[] {
  const src = typeof raw === 'string' ? analyze(raw) : raw
  const text = src.text
  const runs: Run[] = []
  for (const block of text.matchAll(/(?<![\w.])runs\s*\{/g)) {
    const open = block.index + block[0].length - 1
    const close = blockEnd(src, open)
    const entry =
      /(?<![\w.])(?:create|register|named|maybeCreate)\s*\(\s*['"]([\w-]+)['"]\s*\)|(?<![\w.])([A-Za-z_]\w*)\s*\{/g
    entry.lastIndex = open + 1
    for (let m = entry.exec(text); m && m.index < close; m = entry.exec(text)) {
      if (src.depth[m.index] !== src.depth[open] + 1) continue
      const name = m[1] ?? m[2]
      if (RUN_SKIP.has(name) || runs.some(r => r.name === name)) continue
      runs.push({ name, line: src.lineAt(m.index) })
    }
  }
  return runs
}

const runTaskName = (name: string) => 'run' + name[0].toUpperCase() + name.slice(1)

/** 按插件推断的任务（§9.1）；detail 为空，界面给内置说明 */
export function inferTasks(plugins: DetectedPlugins, isRoot: boolean, runs: Run[]): RunTask[] {
  const { keys } = plugins
  const tasks: RunTask[] = []
  const add = (category: string, names: string[], line: number | null = null) => {
    for (const name of names) if (!tasks.some(t => t.name === name)) tasks.push({ name, detail: '', line, category })
  }
  if (plugins.any || isRoot) {
    add('build', ['build', 'clean', 'assemble'])
    add('verification', ['check'])
    add('help', isRoot ? ['dependencies', 'tasks', 'projects'] : ['dependencies', 'tasks'])
  }
  if (JAVA_PLUGINS.some(k => keys.has(k))) {
    add('build', ['jar', 'classes'])
    add('verification', ['test'])
    add('documentation', ['javadoc'])
  }
  if (keys.has('application')) {
    add('application', ['run'])
    add('distribution', ['installDist', 'distZip'])
  }
  if (keys.has('spring-boot')) {
    add('application', ['bootRun'])
    add('build', ['bootJar'])
  }
  if (keys.has('android-app')) {
    add('build', ['assembleDebug', 'assembleRelease', 'bundleRelease'])
    add('install', ['installDebug'])
    add('verification', ['lint', 'testDebugUnitTest', 'connectedAndroidTest'])
  } else if (keys.has('android-lib')) {
    add('build', ['assembleDebug', 'assembleRelease'])
    add('verification', ['lint', 'testDebugUnitTest'])
  }
  if (keys.has('fabric-loom') || keys.has('architectury-loom')) {
    if (runs.length) for (const run of runs) add('fabric', [runTaskName(run.name)], run.line)
    else add('fabric', ['runClient', 'runServer'])
    add('fabric', ['genSources'])
  }
  if (keys.has('moddev') || keys.has('neogradle')) {
    for (const run of runs) add('neoforge', [runTaskName(run.name)], run.line)
  }
  if (keys.has('forgegradle')) {
    for (const run of runs) add('forgegradle runs', [runTaskName(run.name)], run.line)
    add('forgegradle runs', ['genIntellijRuns'])
  }
  if (keys.has('maven-publish')) add('publishing', ['publish', 'publishToMavenLocal'])
  if (keys.has('war')) add('build', ['war'])
  return tasks
}

/** 构建文件里自己写的任务：tasks.register / create、task x { } 等，带后面块里的 group / description */
export function parseCustomTasks(raw: string | Source): RunTask[] {
  const src = typeof raw === 'string' ? analyze(raw) : raw
  const text = src.text
  const found: { name: string; index: number; end: number }[] = []
  const patterns = [
    /(?<![\w])tasks\s*\.\s*(?:register|create)\s*(?:<[^>(]*>)?\s*\(\s*['"]([\w:.-]+)['"]/g,
    /(?<![\w.])task\s*\(\s*['"]([\w:.-]+)['"]/g,
    /(?<![\w.])task\s+['"]?([A-Za-z_][\w-]*)['"]?(?=\s*(?:[({<]|$))/gm,
    /(?<![\w.])val\s+(\w+)\s+by\s+tasks\s*\.\s*(?:registering|creating)/g,
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.push({ name: m[1], index: m.index, end: m.index + m[0].length })
  }
  found.sort((a, b) => a.index - b.index)
  const tasks: RunTask[] = []
  for (const hit of found) {
    if (tasks.some(t => t.name === hit.name)) continue
    // 同一行里的第一个 { 是任务的配置块
    const eol = text.indexOf('\n', hit.end)
    const lineEnd = eol < 0 ? text.length : eol
    const open = text.slice(hit.end, lineEnd).indexOf('{')
    let group = ''
    let description = ''
    if (open >= 0) {
      const from = hit.end + open
      const to = blockEnd(src, from)
      for (const m of text.slice(from + 1, to).matchAll(/(?<![\w.])(group|description)\s*=?\s*(['"])(.*?)\2/g)) {
        if (src.depth[from + 1 + m.index] !== src.depth[from] + 1) continue
        if (m[1] === 'group') group ||= m[3]
        else description ||= m[3]
      }
    }
    tasks.push({
      name: hit.name,
      detail: description,
      line: src.lineAt(hit.index),
      category: group ? group.toLowerCase() : 'other',
    })
  }
  return tasks
}

/** 推断的和写的合并：同名用写的，位置不变；其余按出现顺序追加 */
export function mergeTasks(inferred: RunTask[], custom: RunTask[]): RunTask[] {
  const tasks = [...inferred]
  for (const task of custom) {
    const at = tasks.findIndex(t => t.name === task.name)
    if (at >= 0) tasks[at] = task
    else tasks.push(task)
  }
  return tasks
}

// ---------------------------------------------------------------------------
// 版本、gradle.properties
// ---------------------------------------------------------------------------

/** `gradle-8.10-bin.zip` → `8.10` */
export function parseGradleVersion(wrapperProperties: string | null): string | null {
  if (!wrapperProperties) return null
  const m = /^\s*distributionUrl\s*[=:].*?gradle-([\w.]+(?:-(?:rc|milestone)-\d+)?)-(?:bin|all)\.zip/m.exec(
    wrapperProperties,
  )
  return m ? m[1] : null
}

/** 1.8 / 1_8 → 8，其余原样 */
function javaNumber(text: string): string {
  const v = text.replace('_', '.')
  return v.startsWith('1.') && v.length > 2 ? v.slice(2) : v
}

/** 一个 build 文件里写的 Java 版本；没写 null */
export function parseJavaVersion(raw: string | Source): string | null {
  const text = typeof raw === 'string' ? stripComments(raw) : raw.text
  const patterns: RegExp[] = [
    /JavaLanguageVersion\s*\.\s*of\s*\(\s*(\d+)\s*\)/,
    /jvmToolchain\s*\(\s*(\d+)\s*\)/,
    /JavaVersion\s*\.\s*VERSION_(\d+(?:_\d+)?)/,
    /sourceCompatibility\s*=?\s*['"]?(\d+(?:\.\d+)?)/,
    /options\s*\.\s*release\s*=\s*(\d+)/,
    /release\s*\.\s*set\s*\(\s*(\d+)\s*\)/,
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return javaNumber(m[1])
  }
  return null
}

const SECRET_KEY = /pass|secret|token|key|credential/i

/** gradle.properties：`k=v`、`k: v`、`k v`，跳过 # ! 注释和空行；secret 的值不传出 */
export function parseGradleProperties(text: string): GradleProperty[] {
  const props: GradleProperty[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && props.length < MAX_PROPERTIES; i++) {
    const line = lines[i]
    if (/^\s*([#!]|$)/.test(line)) continue
    const m = /^\s*([^\s=:]+)\s*(?:[=:]\s*|\s+)?(.*?)\s*$/.exec(line)
    if (!m) continue
    const secret = SECRET_KEY.test(m[1])
    props.push({ key: m[1], value: secret ? '' : m[2], line: i + 1, secret })
  }
  return props
}

// ---------------------------------------------------------------------------
// 读一个构建
// ---------------------------------------------------------------------------

const joinPosix = (...parts: string[]) => parts.filter(Boolean).join('/')

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readFirst(
  read: GradleReader,
  dir: string,
  names: string[],
): Promise<{ name: string; text: string } | null> {
  for (const name of names) {
    const text = await read(join(dir, name))
    if (text !== null) return { name, text }
  }
  return null
}

/**
 * 读 buildDir（相对工作区根，posix，根是 ''）这个构建：返回每个有任务的项目一组，根项目在前，子项目按项目路径。
 * read 读文件，读不到（不存在或太大）返回 null
 */
export async function readGradleBuild(root: string, buildDir: string, read: GradleReader): Promise<RunTaskGroup[]> {
  const absolute = (dir: string) => (dir ? join(root, ...dir.split('/')) : root)
  const base = absolute(buildDir)
  const hash = createHash('sha1')
  const stamped = (label: string, text: string | null) => {
    if (text !== null) hash.update(label + '\0' + text + '\0')
    return text
  }

  const settings = await readFirst(read, base, SETTINGS_FILES)
  if (settings) stamped(settings.name, settings.text)
  const parsed = settings ? parseSettings(settings.text) : { rootName: null, includes: [], dirs: {} }
  const props = stamped('gradle.properties', await read(join(base, 'gradle.properties')))
  const wrapperText = stamped(
    'gradle-wrapper.properties',
    await read(join(base, 'gradle', 'wrapper', 'gradle-wrapper.properties')),
  )
  const wrapper = (await exists(join(base, 'gradlew'))) || (await exists(join(base, 'gradlew.bat')))

  // 项目：根在前，子项目按项目路径，最多 50 个
  const subs = [...parsed.includes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, MAX_SUBPROJECTS)
  const projects = [':', ...subs]
  const loaded = await Promise.all(
    projects.map(async project => {
      const rel = project === ':' ? '' : (parsed.dirs[project] ?? project.slice(1).replace(/:/g, '/'))
      const build = await readFirst(read, absolute(joinPosix(buildDir, rel)), BUILD_FILES)
      return { project, rel, build, src: build ? analyze(build.text) : null }
    }),
  )
  // 并发读完再按项目顺序记进指纹，不然顺序随读完的先后变，同样的文件指纹也会不同
  for (const { rel, build } of loaded) if (build) stamped(joinPosix(rel, build.name), build.text)
  const stamp = hash.digest('hex').slice(0, 12)

  const properties = props ? parseGradleProperties(props) : []
  let javaVersion: string | null = null
  for (const item of loaded) {
    javaVersion = item.src ? parseJavaVersion(item.src) : null
    if (javaVersion) break
  }
  javaVersion ??=
    properties.find(p => p.key.toLowerCase().replace(/[._-]/g, '') === 'javaversion' && !p.secret)?.value || null

  const groups: RunTaskGroup[] = []
  for (const item of loaded) {
    const isRoot = item.project === ':'
    if (!item.build && !isRoot) continue
    const plugins = item.src ? detectPlugins(item.src) : { keys: new Set<GradlePlugin>(), any: false }
    const tasks = mergeTasks(
      inferTasks(plugins, isRoot, item.src ? parseRuns(item.src) : []),
      item.src ? parseCustomTasks(item.src) : [],
    )
    if (!tasks.length) continue
    const fileName = item.build?.name ?? settings?.name
    if (!fileName) continue
    groups.push({
      kind: 'gradle',
      file: joinPosix(buildDir, item.build ? item.rel : '', fileName),
      dir: joinPosix(buildDir, item.rel),
      gradle: {
        buildDir,
        project: item.project,
        name: isRoot ? (parsed.rootName ?? (buildDir ? basename(buildDir) : basename(root))) : item.project,
        wrapper,
        stamp,
        plugin: mainPlugin(plugins.keys),
        ...(isRoot
          ? {
              gradleVersion: parseGradleVersion(wrapperText),
              javaVersion,
              ...(properties.length ? { properties } : {}),
            }
          : {}),
      },
      tasks,
    })
  }
  return groups
}

// ---------------------------------------------------------------------------
// gradlew tasks --all 的输出（docs/ui/coding-tasks.md §9.2）
// ---------------------------------------------------------------------------

export function parseGradleTaskList(output: string): GradleListedTask[] {
  const tasks: GradleListedTask[] = []
  const lines = output.split(/\r?\n/)
  let category: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^-{3,}$/.test(line) && i > 0) {
      const prev = lines[i - 1].trim()
      if (prev === 'Rules') break
      const header = /^(.+?)\s+tasks$/i.exec(prev)
      if (header) category = header[1].toLowerCase()
      continue
    }
    if (!category || /^-{3,}\s*$/.test(lines[i + 1] ?? '')) continue
    const m = /^([A-Za-z0-9_:][\w:.-]*)(?:\s+-\s+(.*))?$/.exec(line)
    if (!m) continue
    const full = m[1].replace(/^:/, '')
    const cut = full.lastIndexOf(':')
    tasks.push({
      project: cut < 0 ? ':' : ':' + full.slice(0, cut),
      name: cut < 0 ? full : full.slice(cut + 1),
      category,
      description: m[2] ?? '',
    })
  }
  return tasks
}
