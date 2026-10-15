import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverToolProjects,
  inspectProjectPaths,
  parsePathList,
  readToolProjects,
  toolImportFiles,
  toolProjectPaths,
  zcodeIndexPaths,
} from './project-import'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pixelsky-project-import-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const folder = async (name: string): Promise<string> => {
  const path = join(root, name)
  await mkdir(path, { recursive: true })
  return realpath(path)
}
const json = async (path: string, data: unknown): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(data))
}

describe('tool project lists', () => {
  it('reads only project fields from Claude and both Codex list formats', () => {
    expect(
      toolProjectPaths('claude', { projects: { '/repo/a': { secret: 'do-not-export' } }, apiKey: '/secret' }),
    ).toEqual(['/repo/a'])
    expect(
      toolProjectPaths('codex', {
        'local-projects': { a: { rootPaths: ['/a', '/b'] }, bad: { rootPaths: [42] } },
        'electron-saved-workspace-roots': ['/old'],
        'thread-workspace-root-hints': { t: '/not-a-project' },
      }),
    ).toEqual(['/a', '/b', '/old'])
  })
  it('excludes Z Code remote and projectless workspaces', () => {
    expect(
      toolProjectPaths('zcode', {
        recentProjects: ['/recent'],
        lastOpenTabs: ['/legacy'],
        lastWorkspaceSession: [
          { kind: 'local', workspacePath: '/project' },
          { kind: 'local', workspacePath: '/conversation', workspacePurpose: 'conversation' },
          { kind: 'remote', workspacePath: '/remote', target: { kind: 'ssh' } },
        ],
      }),
    ).toEqual(['/recent', '/legacy', '/project'])
  })
  it('supports current and legacy Kimi Code; skips deleted and remote entries', () => {
    expect(
      toolProjectPaths('kimi', {
        workspaces: { active: { root: '/active' }, gone: { root: '/gone' }, bad: {} },
        deleted_workspace_ids: ['gone'],
        work_dirs: [{ path: '/legacy' }, { path: '/local', kaos: 'local' }, { path: '/ssh', kaos: 'ssh' }],
      }),
    ).toEqual(['/active', '/legacy', '/local'])
  })
  it('honors tool-specific home overrides without mixing the two Kimi generations', () => {
    const files = toolImportFiles(root, {
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      CODEX_HOME: join(root, 'codex'),
      ZCODE_DESKTOP_HOME_DIR: join(root, 'zcode'),
      KIMI_CODE_HOME: join(root, 'kimi-new'),
      KIMI_SHARE_DIR: join(root, 'kimi-old'),
    })
    expect(files.claude).toEqual([join(root, 'claude', '.claude.json')])
    expect(files.codex).toEqual([join(root, 'codex', '.codex-global-state.json')])
    expect(files.zcode).toEqual([join(root, 'zcode', '.zcode', 'v2', 'setting.json')])
    expect(files.kimi).toEqual([join(root, 'kimi-new', 'workspaces.json'), join(root, 'kimi-old', 'kimi.json')])
  })
})

describe('path preview', () => {
  it('accepts BOM, CRLF, quoted paths and JSON arrays; rejects invalid or excessive lists', () => {
    expect(parsePathList('\uFEFF  "D:\\project a"\r\n E:\\repo\r\n')).toEqual(['"D:\\project a"', 'E:\\repo'])
    expect(parsePathList('["/a", "/b"]')).toEqual(['/a', '/b'])
    expect(() => parsePathList('[1]')).toThrow('字符串数组')
    expect(() => parsePathList('["invalid-json]')).toThrow('JSON 格式')
    expect(() => parsePathList(Array(10001).fill('/a').join('\n'))).toThrow('10000')
  })
  it('deduplicates real paths across sources, marks known, missing and non-directory paths', async () => {
    const a = await folder('项目 with spaces'),
      b = await folder('other'),
      file = join(root, 'file')
    await writeFile(file, '')
    const alias = join(root, 'alias')
    await symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const result = await inspectProjectPaths(
      [
        { path: `"${a}"`, source: 'Z Code' },
        { path: alias, source: 'Kimi Code' },
        { path: b, source: 'Folders' },
        { path: file, source: 'Paths' },
        { path: join(root, 'missing'), source: 'Paths' },
        { path: 'relative', source: 'Paths' },
      ],
      [alias],
    )
    expect(result.candidates).toHaveLength(5)
    expect(result.candidates[0]).toMatchObject({ path: a, sources: ['Z Code', 'Kimi Code'], added: true })
    expect(result.candidates[1]).toMatchObject({ path: b, added: false, project: true })
    expect(result.candidates.slice(2).map(c => c.issue)).toEqual(['notDirectory', 'missing', 'invalid'])
  })
  it('keeps parent-scan selection hints while merging explicit tool selections', async () => {
    const a = await folder('plain')
    const result = await inspectProjectPaths(
      [
        { path: a, source: 'parent', project: false },
        { path: a, source: 'Z Code' },
      ],
      [],
    )
    expect(result.candidates[0].project).toBe(true)
  })
})

describe('read-only discovery', () => {
  it('discovers multiple tools, preserves source files and tolerates a broken list without leaking content', async () => {
    const a = await folder('a'),
      b = await folder('b')
    const files = toolImportFiles(root, {})
    await json(files.claude[0], { projects: { [a]: {} } })
    await json(files.kimi[0], { workspaces: { b: { root: b } } })
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(files.codex[0], '{ secret-token-do-not-return')
    const before = await readFile(files.claude[0])
    const result = await discoverToolProjects([], root, {})
    expect(result.candidates.map(c => c.path)).toEqual([a, b])
    expect(result.warnings).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('secret-token')
    expect(await readFile(files.claude[0])).toEqual(before)
    await expect(readToolProjects('codex', files.codex[0], {})).rejects.toThrow('JSON 格式')
  })
  it('recovers Z Code paths beyond the ten recent projects using a read-only SQLite index', async () => {
    const file = join(root, 'tasks-index.sqlite')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE tasks (workspace_path TEXT, workspace_key TEXT, workspace_identity TEXT, deleted INTEGER)')
    const insert = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)')
    const paths = Array.from({ length: 15 }, (_, i) => join(root, `project-${i}`))
    for (const path of paths) insert.run(path, path, null, 0)
    insert.run(paths[0], paths[0], null, 0)
    insert.run('/gone', '/gone', null, 1)
    insert.run('/remote', 'remote:ssh:host:22:user:/remote', null, 0)
    insert.run('/remote2', '/remote2', 'remote:wsl:Ubuntu:/remote2', 0)
    insert.run(join(root, '.zcode', 'workspace', 'default'), 'conversation', null, 0)
    db.close()
    const digest = async (): Promise<string> =>
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
    const before = await digest()
    expect(zcodeIndexPaths(file)).toEqual(paths)
    expect(await digest()).toBe(before)
    const setting = join(root, 'settings', 'setting.json')
    await json(setting, { recentProjects: [paths[0]], dataBaseDir: join(root, 'custom') })
    const customDir = await folder('custom/.zcode/v2')
    await writeFile(join(customDir, 'tasks-index.sqlite'), await readFile(file))
    const result = await readToolProjects('zcode', setting, {})
    expect(new Set(result.paths.map(p => p.path)).size).toBe(15)
    expect(result.warnings).toEqual([])
    const reader = new DatabaseSync(file, { readOnly: true })
    expect(() => reader.exec('DELETE FROM tasks')).toThrow()
    reader.close()
  })
  it('discovers an independent Z Code index when settings are missing or broken', async () => {
    const project = await folder('index-only-project')
    const dataDir = await folder('redirected/.zcode/v2')
    const db = new DatabaseSync(join(dataDir, 'tasks-index.sqlite'))
    db.exec('CREATE TABLE tasks (workspace_path TEXT, workspace_key TEXT, workspace_identity TEXT, deleted INTEGER)')
    db.prepare('INSERT INTO tasks VALUES (?, ?, NULL, 0)').run(project, project)
    db.close()
    const env = { ZCODE_DATA_BASE_DIR: join(root, 'redirected') }
    const missing = await discoverToolProjects([], root, env)
    expect(missing.candidates.map(c => c.path)).toEqual([project])
    expect(missing.warnings).toEqual([])
    const settings = toolImportFiles(root, env).zcode[0]
    await mkdir(join(settings, '..'), { recursive: true })
    await writeFile(settings, '{broken')
    const broken = await discoverToolProjects([], root, env)
    expect(broken.candidates.map(c => c.path)).toEqual([project])
    expect(broken.warnings).toHaveLength(1)
  })
})
