import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionPacks } from './service'
import { readStateFile, writeStateFile } from './store'
import { cleanTemp, copyFixture, FIXTURES, tempDir } from './testing'

afterEach(cleanTemp)

interface Env {
  base: string
  dataDir: string
  builtinDir: string
  folders: string
}

function env(builtin: string[] = []): Env {
  const base = tempDir()
  const builtinDir = join(base, 'builtin')
  const folders = join(base, 'folders')
  mkdirSync(builtinDir)
  mkdirSync(folders)
  for (const name of builtin) copyFixture(name, builtinDir)
  return { base, dataDir: join(base, 'data'), builtinDir, folders }
}

const make = (e: Env): ExtensionPacks =>
  new ExtensionPacks({ dataDir: e.dataDir, builtinDir: e.builtinDir, appVersion: '0.4.1-beta' })

async function started(e: Env): Promise<ExtensionPacks> {
  const svc = make(e)
  svc.start()
  await svc.ready()
  return svc
}

const stateFile = (e: Env): string => join(e.dataDir, 'state.json')
const pack = (svc: ExtensionPacks, id: string) => svc.state().packs.find(p => p.id === id)!

function trySymlink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path)
    return true
  } catch {
    return false
  }
}

describe('加载', () => {
  it('构造不做 I/O，start 之前什么都没发生；start 幂等', async () => {
    const e = env(['pixelsky.dotenv'])
    const svc = make(e)
    expect(svc.state()).toEqual({ revision: 0, loading: true, packs: [] })
    expect(existsSync(e.dataDir)).toBe(false)
    svc.start()
    svc.start()
    await svc.ready()
    expect(svc.state().packs).toHaveLength(1)
    expect(svc.state().loading).toBe(false)
  })

  it('内置扩展：key 是 b-<id>，来源 builtin，默认启用', async () => {
    const svc = await started(env(['pixelsky.dotenv']))
    const [p] = svc.state().packs
    expect(p).toMatchObject({
      key: 'b-pixelsky.dotenv',
      id: 'pixelsky.dotenv',
      source: 'builtin',
      enabled: true,
      live: true,
    })
  })

  it('内置目录不存在也能启动', async () => {
    const e = env()
    const svc = new ExtensionPacks({ dataDir: e.dataDir, builtinDir: join(e.base, 'nope'), appVersion: '0.4.1-beta' })
    svc.start()
    await svc.ready()
    expect(svc.state().packs).toEqual([])
  })

  it('addFolder：加载、保存、广播，目录原样不动', async () => {
    const e = env()
    const svc = await started(e)
    const changed = vi.fn()
    svc.onChange(changed)
    const dir = copyFixture('pixelsky.dotenv', e.folders)
    const before = readFileSync(join(dir, 'pixelsky-extension.json'), 'utf8')
    const info = await svc.addFolder(dir)
    expect(info).toMatchObject({ id: 'pixelsky.dotenv', source: 'folder', enabled: true, live: true })
    expect(info.key).toMatch(/^f-[0-9a-f]{12}$/)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(readStateFile(stateFile(e)).folders.map(f => f.path)).toEqual([dir])
    expect(readFileSync(join(dir, 'pixelsky-extension.json'), 'utf8')).toBe(before)
  })

  it('addFolder 拒绝：没有清单、重复路径、重复 id', async () => {
    const e = env()
    const svc = await started(e)
    await expect(svc.addFolder(join(e.folders, 'missing'))).rejects.toThrow('extpacks.noManifest')
    const a = copyFixture('pixelsky.dotenv', e.folders, 'a')
    await svc.addFolder(a)
    await expect(svc.addFolder(a)).rejects.toThrow('extpacks.duplicatePath')
    const b = copyFixture('pixelsky.dotenv', e.folders, 'b')
    await expect(svc.addFolder(b)).rejects.toThrow('extpacks.duplicateId')
    expect(svc.state().packs).toHaveLength(1)
  })

  it('有错误的扩展照样加进来（status error），作者能看到问题', async () => {
    const e = env()
    const svc = await started(e)
    const info = await svc.addFolder(copyFixture('bad-manifest', e.folders))
    expect(info.status).toBe('error')
    expect(info.live).toBe(false)
    expect(svc.state().packs).toHaveLength(1)
  })

  it('状态文件里的重复 id：后到的整个扩展报错', async () => {
    const e = env(['pixelsky.dotenv'])
    const dir = copyFixture('pixelsky.dotenv', e.folders)
    writeStateFile(stateFile(e), {
      version: 1,
      folders: [{ path: dir, enabled: true, addedAt: 5, options: {} }],
      builtin: {},
      store: {},
    })
    const svc = await started(e)
    const [first, second] = svc.state().packs
    expect(first.status).not.toBe('error')
    expect(second.status).toBe('error')
    expect(second.issues.map(i => i.code)).toContain('pack.duplicateId')
  })

  it('删掉先到的重复 id 扩展后，后到的那个恢复正常', async () => {
    const e = env()
    const a = copyFixture('pixelsky.dotenv', e.folders, 'a')
    const b = copyFixture('pixelsky.dotenv', e.folders, 'b')
    writeStateFile(stateFile(e), {
      version: 1,
      folders: [
        { path: a, enabled: true, addedAt: 1, options: {} },
        { path: b, enabled: true, addedAt: 2, options: {} },
      ],
      builtin: {},
      store: {},
    })
    const svc = await started(e)
    const [first, second] = svc.state().packs
    expect(second.status).toBe('error')
    await svc.remove(first.key)
    const left = svc.state().packs[0]
    expect(left.key).toBe(second.key)
    expect(left.issues.map(i => i.code)).not.toContain('pack.duplicateId')
    expect(left.status).not.toBe('error')
    expect(left.live).toBe(true)
  })

  it('state.json 读不出来（不是损坏）：原文件不动，也不会被空状态覆盖', async () => {
    const e = env(['pixelsky.dotenv'])
    mkdirSync(stateFile(e), { recursive: true }) // 当目录用，readFileSync 会抛 EISDIR
    const svc = await started(e)
    await svc.setEnabled('b-pixelsky.dotenv', false)
    expect(readdirSync(e.dataDir).filter(n => n.startsWith('state.json'))).toEqual(['state.json'])
    expect(readdirSync(stateFile(e))).toEqual([])
    const st = readStateFile(stateFile(e))
    expect(st.unreadable).toBe(true)
    expect(st.folders).toEqual([])
  })

  it('builtinReady 之后内置扩展已经在 state() 里，文件夹扩展还在加载（loading: true）', async () => {
    const e = env(['pixelsky.dotenv'])
    const dir = copyFixture('with-skill', e.folders)
    writeStateFile(stateFile(e), {
      version: 1,
      folders: [{ path: dir, enabled: true, addedAt: 5, options: {} }],
      builtin: {},
      store: {},
    })
    const svc = make(e)
    await svc.builtinReady()
    const mid = svc.state()
    expect(mid.loading).toBe(true)
    expect(mid.packs.map(p => p.source)).toEqual(['builtin'])
    await svc.ready()
    expect(svc.state().loading).toBe(false)
    expect(svc.state().packs.map(p => p.source)).toEqual(['builtin', 'folder'])
  })

  it('损坏的 state.json：留一份 .bad，用空状态启动', async () => {
    const e = env(['pixelsky.dotenv'])
    mkdirSync(e.dataDir, { recursive: true })
    writeFileSync(stateFile(e), '{ oops')
    const svc = await started(e)
    expect(svc.state().packs).toHaveLength(1)
    expect(readdirSync(e.dataDir).some(n => n.startsWith('state.json.bad-'))).toBe(true)
  })
})

describe('开关、移除、重新加载、选项', () => {
  it('启用 / 停用写进状态文件，换一个实例还在', async () => {
    const e = env(['pixelsky.dotenv'])
    const svc = await started(e)
    const key = svc.state().packs[0].key
    await svc.setEnabled(key, false)
    expect(svc.state().packs[0]).toMatchObject({ enabled: false, live: false })
    const second = await started(e)
    expect(second.state().packs[0]).toMatchObject({ enabled: false, live: false })
    await second.setEnabled(key, true)
    expect((await started(e)).state().packs[0].live).toBe(true)
  })

  it('文件夹扩展的开关和选项也跨实例保存', async () => {
    const e = env()
    const svc = await started(e)
    const info = await svc.addFolder(copyFixture('pixelsky.dotenv', e.folders))
    await svc.setEnabled(info.key, false)
    await svc.setOptions(info.key, { overrideBuiltin: ['dotenv'] })
    const again = await started(e)
    expect(again.state().packs[0]).toMatchObject({ enabled: false, options: { overrideBuiltin: ['dotenv'] } })
  })

  it('每次变更 revision 加一并通知监听者；取消监听后不再通知', async () => {
    const e = env(['pixelsky.dotenv'])
    const svc = await started(e)
    const r0 = svc.state().revision
    const listener = vi.fn()
    const off = svc.onChange(listener)
    await svc.setEnabled(svc.state().packs[0].key, false)
    expect(svc.state().revision).toBe(r0 + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    await svc.setEnabled(svc.state().packs[0].key, true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('移除文件夹扩展：从列表和状态文件去掉，目录还在；内置不能移除', async () => {
    const e = env(['pixelsky.dotenv'])
    const svc = await started(e)
    const dir = copyFixture('with-skill', e.folders)
    const info = await svc.addFolder(dir)
    await svc.remove(info.key)
    expect(svc.state().packs.map(p => p.source)).toEqual(['builtin'])
    expect(readStateFile(stateFile(e)).folders).toEqual([])
    expect(existsSync(join(dir, 'pixelsky-extension.json'))).toBe(true)
    await expect(svc.remove('b-pixelsky.dotenv')).rejects.toThrow('extpacks.builtinRemove')
    await expect(svc.remove('f-nope')).rejects.toThrow('extpacks.unknownPack')
  })

  it('重新加载：扩展自己的 revision 加一并读到新内容', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('with-skill', e.folders)
    const info = await svc.addFolder(dir)
    const file = join(dir, 'pixelsky-extension.json')
    writeFileSync(file, readFileSync(file, 'utf8').replace('Two skills, one per engine mix', 'Edited description'))
    await svc.reload(info.key)
    const after = pack(svc, 'pixelsky.with-skill')
    expect(after.revision).toBe(info.revision + 1)
    expect(after.manifest?.description).toBe('Edited description')
    await svc.reload(null)
    expect(pack(svc, 'pixelsky.with-skill').revision).toBe(info.revision + 2)
  })

  it('重新加载能让坏扩展变好', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('bad-manifest', e.folders)
    const info = await svc.addFolder(dir)
    expect(info.status).toBe('error')
    writeFileSync(
      join(dir, 'pixelsky-extension.json'),
      readFileSync(join(FIXTURES, 'with-tasks/pixelsky-extension.json')),
    )
    await svc.reload(info.key)
    expect(svc.state().packs[0].id).toBe('pixelsky.with-tasks')
    expect(svc.state().packs[0].status).not.toBe('error')
  })

  it('串行执行：同时发起的变更都完成，状态一致', async () => {
    const e = env()
    const svc = await started(e)
    const a = copyFixture('with-skill', e.folders, 'a')
    const b = copyFixture('with-tasks', e.folders, 'b')
    await Promise.all([svc.addFolder(a), svc.addFolder(b)])
    expect(svc.state().packs).toHaveLength(2)
    expect(readStateFile(stateFile(e)).folders).toHaveLength(2)
  })
})

describe('readJson / readText / assetFile', () => {
  async function withDotenv(): Promise<{ svc: ExtensionPacks; key: string; dir: string; e: Env }> {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('pixelsky.dotenv', e.folders)
    const info = await svc.addFolder(dir)
    return { svc, key: info.key, dir, e }
  }

  it('readJson：读 .json，允许注释和结尾逗号', async () => {
    const { svc, key, dir } = await withDotenv()
    expect(await svc.readJson(key, 'syntaxes/dotenv.tmLanguage.json')).toMatchObject({ scopeName: 'source.dotenv' })
    writeFileSync(join(dir, 'snippets', 'extra.json'), '// 注释\n{ "a": 1, }')
    await svc.reload(key)
    expect(await svc.readJson(key, 'snippets/extra.json')).toEqual({ a: 1 })
  })

  it('readJson 拒绝：越界、绝对路径、反斜杠、非 json、不存在、未知扩展', async () => {
    const { svc, key, dir } = await withDotenv()
    writeFileSync(join(dir, '..', 'x.json'), '{}')
    for (const bad of [
      '../x.json',
      '/etc/passwd.json',
      'C:/x.json',
      'syntaxes\\dotenv.tmLanguage.json',
      'README.md',
      'nope.json',
    ])
      await expect(svc.readJson(key, bad)).rejects.toThrow('extpacks.badPath')
    await expect(svc.readJson('f-none', 'a.json')).rejects.toThrow('extpacks.unknownPack')
  })

  it('readText：只读 .md / .txt / LICENSE*', async () => {
    const { svc, key } = await withDotenv()
    expect(await svc.readText(key, 'README.md')).toContain('#')
    expect(await svc.readText(key, 'LICENSE')).toBeTruthy()
    await expect(svc.readText(key, 'pixelsky-extension.json')).rejects.toThrow('extpacks.badPath')
    await expect(svc.readText(key, '../README.md')).rejects.toThrow('extpacks.badPath')
  })

  it('readText 太大：拒绝（≤256 KB）', async () => {
    const { svc, key, dir } = await withDotenv()
    writeFileSync(join(dir, 'big.md'), 'x'.repeat(300 * 1024))
    await svc.reload(key)
    await expect(svc.readText(key, 'big.md')).rejects.toThrow('extpacks.badPath')
  })

  it('readJson 不读符号链接', async () => {
    const { svc, key, dir, e } = await withDotenv()
    writeFileSync(join(e.base, 'outside.json'), '{"secret":1}')
    if (!trySymlink(join(e.base, 'outside.json'), join(dir, 'link.json'))) return
    await svc.reload(key)
    await expect(svc.readJson(key, 'link.json')).rejects.toThrow('extpacks.badPath')
  })

  it('assetFile：svg / png 给文件和类型，json、不存在、越界都是 null', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('unsafe-svg', e.folders)
    const key = (await svc.addFolder(dir)).key
    expect(await svc.assetFile(key, 'icons/good.svg')).toEqual({
      file: join(dir, 'icons/good.svg'),
      mime: 'image/svg+xml',
    })
    writeFileSync(join(dir, 'icons', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await svc.reload(key)
    expect((await svc.assetFile(key, 'icons/a.png'))?.mime).toBe('image/png')
    expect(await svc.assetFile(key, 'icons.json')).toBeNull()
    expect(await svc.assetFile(key, 'icons/none.svg')).toBeNull()
    expect(await svc.assetFile(key, '../x.svg')).toBeNull()
    expect(await svc.assetFile('f-none', 'icons/good.svg')).toBeNull()
  })

  it('assetFile 拒绝不安全的 svg（file 级错误）', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('unsafe-svg', e.folders)
    const info = await svc.addFolder(dir)
    expect(info.issues.some(i => i.code === 'svg.unsafe' && i.scope === 'file')).toBe(true)
    expect(await svc.assetFile(info.key, 'icons/bad.svg')).toBeNull()
  })

  it('assetFile 拒绝停用的扩展（扩展自己的图标除外）', async () => {
    const e = env()
    const svc = await started(e)
    const info = await svc.addFolder(copyFixture('unsafe-svg', e.folders))
    await svc.setEnabled(info.key, false)
    expect(await svc.assetFile(info.key, 'icons/good.svg')).toBeNull()
    await svc.setEnabled(info.key, true)
    expect(await svc.assetFile(info.key, 'icons/good.svg')).not.toBeNull()
  })

  it('assetFile 拒绝符号链接', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('unsafe-svg', e.folders)
    if (!trySymlink(join(dir, 'icons', 'good.svg'), join(dir, 'icons', 'link.svg'))) return
    const info = await svc.addFolder(dir)
    expect(await svc.assetFile(info.key, 'icons/link.svg')).toBeNull()
  })

  it('location：扩展目录；未知 key 抛 unknownPack', async () => {
    const { svc, key, dir } = await withDotenv()
    expect(svc.location(key)).toBe(dir)
    expect(() => svc.location('f-none')).toThrow('extpacks.unknownPack')
  })
})

describe('技能', () => {
  const skillState = (e: Env, dir: string): void =>
    writeStateFile(stateFile(e), {
      version: 1,
      folders: [{ path: dir, enabled: true, addedAt: 5, options: {} }],
      builtin: {},
      store: {},
    })

  it('ready 之前：没有带技能的扩展 key 为空，有就是 loading，且不给目录', async () => {
    const empty = env(['pixelsky.dotenv'])
    const a = make(empty)
    a.start()
    expect(a.skillLaunch('claude')).toEqual({ key: '', pluginDirs: [], skillRoots: [] })
    await a.ready()

    const e = env()
    skillState(e, copyFixture('with-skill', e.folders))
    const b = make(e)
    b.start()
    expect(b.skillLaunch('claude')).toEqual({ key: 'loading', pluginDirs: [], skillRoots: [] })
    expect(b.skillLaunch('codex').key).toBe('loading')
    expect(b.skillLaunch('pixel').key).toBe('')
    await b.ready()
    expect(b.skillLaunch('claude').key).not.toBe('loading')
  })

  it('claude：插件目录已建好；codex：技能目录；命令列表', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('with-skill', e.folders)
    await svc.addFolder(dir)
    const claude = svc.skillLaunch('claude')
    expect(claude.pluginDirs).toHaveLength(1)
    expect(existsSync(join(claude.pluginDirs[0], 'skills', 'hello', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(claude.pluginDirs[0], '.claude-plugin', 'plugin.json'))).toBe(true)
    const codex = svc.skillLaunch('codex')
    expect(codex.skillRoots).toEqual([join(dir, 'skills/hello'), join(dir, 'skills/hola')])
    expect(svc.skillCommands().map(c => c.name)).toEqual(['ext-pixelsky-with-skill:hello'])
  })

  it('无关扩展开关：claude key 不变，已有包装目录不动', async () => {
    const e = env(['pixelsky.dotenv'])
    const svc = await started(e)
    await svc.addFolder(copyFixture('with-skill', e.folders))
    const before = svc.skillLaunch('claude')
    const dirs = readdirSync(join(e.dataDir, 'runtime', 'claude'))
    await svc.setEnabled('b-pixelsky.dotenv', false)
    await svc.setEnabled('b-pixelsky.dotenv', true)
    const icon = await svc.addFolder(copyFixture('unsafe-svg', e.folders))
    await svc.setEnabled(icon.key, false)
    expect(svc.skillLaunch('claude')).toEqual(before)
    expect(readdirSync(join(e.dataDir, 'runtime', 'claude'))).toEqual(dirs)
  })

  it('停用带技能的扩展：key 变空；再启用恢复同一个目录', async () => {
    const e = env()
    const svc = await started(e)
    const info = await svc.addFolder(copyFixture('with-skill', e.folders))
    const on = svc.skillLaunch('claude')
    await svc.setEnabled(info.key, false)
    expect(svc.skillLaunch('claude').key).toBe('')
    expect(svc.skillCommands()).toEqual([])
    await svc.setEnabled(info.key, true)
    expect(svc.skillLaunch('claude')).toEqual(on)
  })

  it('重新加载后包装目录换名（内容寻址），旧的留到下次启动才清', async () => {
    const e = env()
    const svc = await started(e)
    const info = await svc.addFolder(copyFixture('with-skill', e.folders))
    const old = svc.skillLaunch('claude')
    await svc.reload(info.key)
    const fresh = svc.skillLaunch('claude')
    expect(fresh.pluginDirs[0]).not.toBe(old.pluginDirs[0])
    expect(existsSync(old.pluginDirs[0])).toBe(true)
    // 下次启动：start() 清空包装目录，再给带技能的扩展重建
    const next = await started(e)
    expect(existsSync(fresh.pluginDirs[0])).toBe(false)
    expect(next.skillLaunch('claude').pluginDirs).toHaveLength(1)
  })

  it('移除 → 改文件 → 重新添加同一目录：revision 不复用，读到新内容，Claude 包装是新的 SKILL.md', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('with-skill', e.folders)
    const first = await svc.addFolder(dir)
    const oldDir = svc.skillLaunch('claude').pluginDirs[0]
    await svc.remove(first.key)
    const skill = join(dir, 'skills', 'hello', 'SKILL.md')
    writeFileSync(
      skill,
      readFileSync(skill, 'utf8').replace('Say hello to the user.', 'New instructions after reinstall.'),
    )
    const second = await svc.addFolder(dir)
    expect(second.key).toBe(first.key)
    expect(second.revision).toBeGreaterThan(first.revision)
    const next = svc.skillLaunch('claude').pluginDirs[0]
    expect(next).not.toBe(oldDir)
    expect(readFileSync(join(next, 'skills', 'hello', 'SKILL.md'), 'utf8')).toContain(
      'New instructions after reinstall.',
    )
  })

  it('移除 → 改片段 → 重新添加：readJson 与 revision 都是新的', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('pixelsky.dotenv', e.folders)
    const snippets = join(dir, 'snippets', 'dotenv.json')
    writeFileSync(snippets, '{"example":{"prefix":"demo","body":"OLD"}}')
    const first = await svc.addFolder(dir)
    expect(await svc.readJson(first.key, 'snippets/dotenv.json')).toEqual({ example: { prefix: 'demo', body: 'OLD' } })
    await svc.remove(first.key)
    writeFileSync(snippets, '{"example":{"prefix":"demo","body":"NEW"}}')
    const second = await svc.addFolder(dir)
    expect(second.revision).not.toBe(first.revision)
    expect(await svc.readJson(second.key, 'snippets/dotenv.json')).toEqual({ example: { prefix: 'demo', body: 'NEW' } })
  })

  it('改 SKILL.md 后重新加载：包装目录换名并带新正文', async () => {
    const e = env()
    const svc = await started(e)
    const dir = copyFixture('with-skill', e.folders)
    const info = await svc.addFolder(dir)
    const old = svc.skillLaunch('claude').pluginDirs[0]
    const skill = join(dir, 'skills', 'hello', 'SKILL.md')
    writeFileSync(skill, readFileSync(skill, 'utf8') + '\nReloaded text.\n')
    await svc.reload(info.key)
    const fresh = svc.skillLaunch('claude').pluginDirs[0]
    expect(fresh).not.toBe(old)
    expect(readFileSync(join(fresh, 'skills', 'hello', 'SKILL.md'), 'utf8')).toContain('Reloaded text.')
  })

  it('GC 只在 start() 里跑：构造和其它调用不清包装目录', async () => {
    const e = env()
    const svc = await started(e)
    await svc.addFolder(copyFixture('with-skill', e.folders))
    const dir = svc.skillLaunch('claude').pluginDirs[0]
    const other = make(e)
    other.state()
    other.skillLaunch('claude')
    expect(existsSync(dir)).toBe(true)
    await svc.reload(null)
    expect(existsSync(dir)).toBe(true)
  })
})
