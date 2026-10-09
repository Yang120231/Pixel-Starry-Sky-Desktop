import { spawn, execFile } from 'node:child_process'
import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { EditorItem, EditorKind, EditorState, WorkspaceRef } from '../../shared/types/workspace'
import { workspacePath, type TargetResolver } from './workspace-files'

export const EDITORS = [
  { id: 'vscode', name: 'VS Code', exe: 'Code.exe', dir: 'Microsoft VS Code', command: 'code' },
  { id: 'cursor', name: 'Cursor', exe: 'Cursor.exe', dir: 'cursor', command: 'cursor' },
  { id: 'windsurf', name: 'Windsurf', exe: 'Windsurf.exe', dir: 'Windsurf', command: 'windsurf' },
  { id: 'trae-cn', name: 'Trae CN', exe: 'Trae CN.exe', dir: 'Trae CN', command: 'trae-cn' },
  { id: 'trae', name: 'Trae', exe: 'Trae.exe', dir: 'Trae', command: 'trae' },
] as const
interface Prefs {
  defaultId: string | null
  openWith: string
  window: 'reuse' | 'new'
  custom: EditorItem[]
}
const DEFAULTS: Prefs = { defaultId: null, openWith: 'app', window: 'reuse', custom: [] }
const KINDS = [...EDITORS.map(e => e.id), 'custom']
const exists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function editorArgs(
  mode: EditorItem['mode'],
  windowMode: EditorState['window'],
  root: string,
  file?: string,
  line?: number,
  column?: number,
): string[] {
  if (mode === 'folder') return [file ?? root]
  const args = [windowMode === 'new' ? '--new-window' : '--reuse-window']
  if (file) {
    args.push(root)
    if (line !== undefined) {
      if (
        !Number.isInteger(line) ||
        line <= 0 ||
        line > 10000000 ||
        (column !== undefined && (!Number.isInteger(column) || column <= 0 || column > 10000000))
      )
        throw new Error('文件行列不正确')
      args.push('--goto', `${file}:${line}:${column ?? 1}`)
    } else args.push(file)
  } else args.push(root)
  return args
}

function registryPath(exe: string, hive: 'HKCU' | 'HKLM'): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(done =>
    execFile(
      'reg.exe',
      ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve'],
      { timeout: 1500, windowsHide: true, encoding: 'utf8', maxBuffer: 32000 },
      (err, out) => {
        done(err ? null : (/REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out)?.[1]?.trim().replace(/^"|"$/g, '') ?? null))
      },
    ),
  )
}

export function uninstallLocations(output: string, editor: (typeof EDITORS)[number]): string[] {
  const paths: string[] = []
  for (const block of output.split(/(?=HKEY_)/)) {
    const value = (name: string): string =>
      new RegExp(`^\\s+${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)$`, 'mi').exec(block)?.[1]?.trim() ?? ''
    const name = value('DisplayName')
    const matches =
      editor.id === 'trae-cn'
        ? /^Trae(?:Code)?\s+CN\b/i.test(name)
        : editor.id === 'trae'
          ? /^Trae(?:Code)?\b/i.test(name) && !/\bCN\b/i.test(name)
          : editor.id === 'vscode'
            ? /^(?:Microsoft )?Visual Studio Code\b/i.test(name)
            : new RegExp(`^${editor.name}\\b`, 'i').test(name)
    if (!matches) continue
    const icon = value('DisplayIcon')
      .replace(/,\s*-?\d+$/, '')
      .replace(/^"|"$/g, '')
    const dir = value('InstallLocation').replace(/^"|"$/g, '')
    if (icon.toLowerCase().endsWith('.exe')) paths.push(icon)
    if (dir) paths.push(join(dir, editor.exe))
  }
  return paths
}

function uninstallRegistry(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return Promise.all(
    ['HKCU', 'HKLM'].flatMap(hive =>
      ['', '\\WOW6432Node'].map(
        wow =>
          new Promise<string>(done => {
            execFile(
              'reg.exe',
              ['query', `${hive}\\Software${wow}\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, '/s'],
              { windowsHide: true, timeout: 1000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
              (_err, out) => done(out ?? ''),
            )
          }),
      ),
    ),
  )
}

async function versions(items: EditorItem[]): Promise<Record<string, string>> {
  if (process.platform !== 'win32' || !items.length) return {}
  const paths = items
    .filter(e => e.available)
    .map(e => `'${e.path.replaceAll("'", "''")}'`)
    .join(',')
  if (!paths) return {}
  return new Promise(done =>
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(${paths}) | ForEach-Object { $item=Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue; if($item){ [pscustomobject]@{path=$item.FullName; version=$item.VersionInfo.ProductVersion} } } | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true, timeout: 1500, maxBuffer: 128000, encoding: 'utf8' },
      (err, out) => {
        try {
          if (err) {
            done({})
            return
          }
          const parsed = JSON.parse(out),
            rows = Array.isArray(parsed) ? parsed : [parsed]
          done(
            Object.fromEntries(
              rows
                .filter(r => typeof r.path === 'string' && typeof r.version === 'string')
                .map(r => [r.path.toLowerCase(), r.version]),
            ),
          )
        } catch {
          done({})
        }
      },
    ),
  )
}

export class Editors {
  private prefs: Prefs = { ...DEFAULTS, custom: [] }
  private items: EditorItem[] = []
  private checkedAt = 0
  private detecting: Promise<EditorState> | null = null
  private saving: Promise<void> = Promise.resolve()
  constructor(
    private directory: string,
    private target: TargetResolver,
    private getIcon?: (path: string) => Promise<string | undefined>,
  ) {}
  async init(): Promise<void> {
    try {
      const p = JSON.parse(await readFile(join(this.directory, 'editor-settings.json'), 'utf8'))
      this.prefs = {
        defaultId: typeof p.defaultId === 'string' ? p.defaultId : null,
        openWith: typeof p.openWith === 'string' ? p.openWith : 'app',
        window: p.window === 'new' ? 'new' : 'reuse',
        custom: Array.isArray(p.custom)
          ? p.custom
              .filter(
                (e: EditorItem) =>
                  e &&
                  typeof e.id === 'string' &&
                  typeof e.name === 'string' &&
                  typeof e.path === 'string' &&
                  KINDS.includes(e.kind) &&
                  ['code', 'folder'].includes(e.mode),
              )
              .map((e: EditorItem) => ({ ...e, available: false, manual: true, source: 'manual' }))
          : [],
      }
    } catch {
      /* 未配置或文件损坏使用默认值 */
    }
  }
  private snapshot(): EditorState {
    return {
      items: this.items.map(e => ({ ...e })),
      defaultId: this.prefs.defaultId,
      openWith: this.prefs.openWith,
      window: this.prefs.window,
      checkedAt: this.checkedAt,
    }
  }
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.prefs, null, 2)
    this.saving = this.saving
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true })
        const file = join(this.directory, 'editor-settings.json')
        await writeFile(file + '.tmp', snapshot)
        await rename(file + '.tmp', file)
      })
    return this.saving
  }
  async state(force = false): Promise<EditorState> {
    if (this.detecting) return this.detecting
    if (!force && this.checkedAt && Date.now() - this.checkedAt < 60000) return this.snapshot()
    this.detecting = this.detect()
    try {
      return await this.detecting
    } finally {
      this.detecting = null
    }
  }
  private async detect(): Promise<EditorState> {
    const found: EditorItem[] = []
    const registryOutputPromise = uninstallRegistry()
    const appPaths = Promise.all(
      EDITORS.map(kind => Promise.all([registryPath(kind.exe, 'HKCU'), registryPath(kind.exe, 'HKLM')])),
    )
    const [registryOutput, pathsByKind] = await Promise.all([registryOutputPromise, appPaths])
    for (const manual of this.prefs.custom)
      found.push({ ...manual, available: await exists(manual.path), manual: true, source: 'manual' })
    await Promise.all(
      EDITORS.map(async (kind, index) => {
        const registry = pathsByKind[index]
        const registered = [
          ...registry.filter((p): p is string => !!p),
          ...registryOutput.flatMap(out => uninstallLocations(out, kind)),
        ]
        const locations = [
          ...[process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
            .filter((p): p is string => !!p)
            .flatMap(p => [join(p, 'Programs', kind.dir, kind.exe), join(p, kind.dir, kind.exe)]),
        ]
        if (process.platform === 'win32')
          for (let drive = 65; drive <= 90; drive++) {
            const root = `${String.fromCharCode(drive)}:\\`
            locations.push(
              join(root, kind.dir, kind.exe),
              join(root, 'Program Files', kind.dir, kind.exe),
              join(root, 'Program Files (x86)', kind.dir, kind.exe),
            )
          }
        const inPath: string[] = []
        for (const bin of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
          inPath.push(resolve(bin, '../../..', kind.exe), resolve(bin, '..', kind.exe), join(bin, kind.exe))
        }
        const candidates = [
          ...registered.map(path => ({ path, source: 'registry' as const })),
          ...locations.map(path => ({ path, source: 'location' as const })),
          ...inPath.map(path => ({ path, source: 'path' as const })),
        ]
        const checks = await Promise.all(candidates.map(async c => ({ ...c, available: await exists(c.path) })))
        for (const candidate of checks.filter(c => c.available)) {
          const path = resolve(candidate.path),
            normalized = path.toLowerCase()
          if (found.some(e => e.path.toLowerCase() === normalized)) continue
          const id = found.some(e => e.id === kind.id)
            ? `${kind.id}:${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`
            : kind.id
          found.push({
            id,
            kind: kind.id,
            name: kind.name,
            path,
            source: candidate.source,
            mode: 'code',
            available: true,
            manual: false,
          })
        }
      }),
    )
    if (this.prefs.defaultId && !found.some(e => e.id === this.prefs.defaultId)) {
      const old = this.items.find(e => e.id === this.prefs.defaultId)
      const builtin = EDITORS.find(e => e.id === this.prefs.defaultId)
      if (old || builtin)
        found.push(
          old
            ? { ...old, available: false }
            : {
                id: builtin!.id,
                kind: builtin!.id,
                name: builtin!.name,
                mode: 'code',
                path: '',
                available: false,
                manual: false,
              },
        )
    }
    const metadata = await versions(found)
    await Promise.all(
      found.map(async item => {
        item.version = metadata[item.path.toLowerCase()]
        if (item.available && this.getIcon) item.icon = await this.getIcon(item.path).catch(() => undefined)
      }),
    )
    const rank = (e: EditorItem): number =>
      e.source === 'registry' ? 0 : e.source === 'manual' ? 1 : e.source === 'location' ? 2 : 3
    this.items = found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    this.checkedAt = Date.now()
    if (!this.prefs.defaultId && this.items.some(e => e.available)) {
      this.prefs.defaultId =
        this.items.find(e => e.kind === 'trae-cn' && e.source === 'registry' && e.available)?.id ??
        this.items.find(e => e.available)!.id
      await this.persist()
    }
    return this.snapshot()
  }
  async preferences(value: unknown): Promise<EditorState> {
    const patch = value as Partial<Prefs>
    if (!patch || typeof patch !== 'object') throw new Error('编辑器设置不正确')
    await this.state()
    if (patch.defaultId !== undefined) {
      if (patch.defaultId !== null && !this.items.some(e => e.id === patch.defaultId)) throw new Error('编辑器不存在')
      this.prefs.defaultId = patch.defaultId
    }
    if (patch.window !== undefined) {
      if (patch.window !== 'reuse' && patch.window !== 'new') throw new Error('窗口方式不正确')
      this.prefs.window = patch.window
    }
    if (patch.openWith !== undefined) {
      if (patch.openWith !== 'app' && !this.items.some(e => e.id === patch.openWith)) throw new Error('打开方式不存在')
      this.prefs.openWith = patch.openWith
    }
    await this.persist()
    return this.snapshot()
  }
  async configure(kind: EditorKind, path: string, name?: string, mode?: 'code' | 'folder'): Promise<EditorState> {
    if (!KINDS.includes(kind)) throw new Error('未知编辑器')
    if (!(await exists(path)) || (process.platform === 'win32' && !path.toLowerCase().endsWith('.exe')))
      throw new Error('请选择编辑器的 exe 程序')
    const builtin = EDITORS.find(e => e.id === kind)
    const id = builtin?.id ?? 'custom:' + randomUUID()
    const item: EditorItem = {
      id,
      kind,
      name: builtin?.name ?? name?.trim().slice(0, 60) ?? '自定义编辑器',
      path,
      mode: builtin ? 'code' : mode === 'code' ? 'code' : 'folder',
      available: true,
      manual: true,
    }
    this.prefs.custom = [...this.prefs.custom.filter(e => e.id !== id), item]
    await this.persist()
    return this.state(true)
  }
  async remove(id: string): Promise<EditorState> {
    this.prefs.custom = this.prefs.custom.filter(e => e.id !== id)
    if (this.prefs.defaultId === id && id.startsWith('custom:')) this.prefs.defaultId = null
    if (this.prefs.openWith === id && id.startsWith('custom:')) this.prefs.openWith = 'app'
    await this.persist()
    return this.state(true)
  }
  async open(
    ref: WorkspaceRef,
    editorId?: string,
    path?: string,
    line?: number,
    column?: number,
  ): Promise<{ editor: string; target: string }> {
    if (editorId !== undefined && typeof editorId !== 'string') throw new Error('编辑器 ID 不正确')
    if (path !== undefined && typeof path !== 'string') throw new Error('文件路径不正确')
    const target = this.target(ref)
    const root = await workspacePath(target.path, '', 'directory')
    const file = path ? await workspacePath(root, path, 'file') : undefined
    const state = await this.state()
    const editor = state.items.find(e => e.id === (editorId ?? state.defaultId))
    if (!editor) throw new Error('先选择默认编辑器')
    if (!editor.available || !editor.path || !(await exists(editor.path))) {
      this.checkedAt = 0
      throw new Error('默认编辑器不可用，请重新检测或指定路径')
    }
    const args = editorArgs(editor.mode, this.prefs.window, root, file, line, column)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    await new Promise<void>((done, fail) => {
      const child = spawn(editor.path, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore', env })
      child.once('error', e => fail(new Error('编辑器启动失败：' + e.message)))
      child.once('spawn', () => {
        child.unref()
        done()
      })
    })
    return { editor: editor.name, target: file ?? root }
  }
}
