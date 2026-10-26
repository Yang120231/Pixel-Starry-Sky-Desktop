import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { WorkspaceFiles, workspacePath, workspaceRef, TEXT_LIMIT, READ_LIMIT } from './workspace-files'
import { editorArgs, Editors } from './editors'

let folder: string, root: string, service: WorkspaceFiles
const ref = { projectId: 'project' }
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  folder = await mkdtemp(join(scratch, 'editor-file-test-'))
  root = join(folder, '中文 & 项目 (1)')
  await mkdir(root)
  service = new WorkspaceFiles(value => {
    if (value.projectId !== ref.projectId) throw new Error('项目已不存在')
    return { ref: value, name: '测试项目', path: root }
  })
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('项目文件', () => {
  it('目录与名称筛选使用真实路径，忽略 .git，目录优先排序', async () => {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'README.md'), 'hello')
    await writeFile(join(root, 'src', 'main.ts'), 'export const n = 1\n')
    expect((await service.list(ref, '')).entries.map(e => e.path)).toEqual(['src', 'README.md'])
    expect((await service.search(ref, 'main')).entries).toMatchObject([{ path: 'src/main.ts', kind: 'file' }])
  })
  it('sizes：只有文件带字节数（符号链接是目标的大小）；不要就不带', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'a.txt'), 'hello')
    await writeFile(join(root, 'empty'), '')
    if (process.platform !== 'win32') await symlink(join(root, 'a.txt'), join(root, 'link'))
    const sized = Object.fromEntries((await service.list(ref, '', true)).entries.map(e => [e.name, e.size]))
    expect(sized).toMatchObject({ src: undefined, 'a.txt': 5, empty: 0 })
    if (process.platform !== 'win32') expect(sized.link).toBe(5)
    expect((await service.list(ref, '')).entries.every(e => !('size' in e))).toBe(true)
  })
  it('只问有没有（路径链接、@ 菜单）：目录不存在返回 null、不报错；其他错误照常报', async () => {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'main.ts'), '')
    expect((await service.listExisting(ref, 'src'))?.entries.map(e => e.path)).toEqual(['src/main.ts'])
    expect(await service.listExisting(ref, 'not/created/yet')).toBeNull()
    await expect(service.list(ref, 'not/created/yet')).rejects.toThrow('files.notFound')
    await expect(service.listExisting(ref, '../outside')).rejects.toThrow('files.outsideProject')
  })
  it('保存保留 UTF-8 BOM 和 CRLF；过期版本及同时保存不覆盖', async () => {
    const file = join(root, '文本 & 文件.txt')
    await writeFile(file, Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('旧内容\r\n')]))
    const doc = await service.read(ref, '文本 & 文件.txt')
    expect(doc.kind).toBe('text')
    if (doc.kind !== 'text') throw new Error('not text')
    const saved = await service.save(ref, doc.path, '新内容\n第二行\n', doc.version)
    expect(await readFile(file)).toEqual(
      Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from('新内容\r\n第二行\r\n')]),
    )
    await expect(service.save(ref, doc.path, '覆盖', doc.version)).rejects.toThrow('files.changedOutside')
    const concurrent = await Promise.allSettled([
      service.save(ref, doc.path, '第一笔', saved.version),
      service.save(ref, doc.path, '第二笔', saved.version),
    ])
    expect(concurrent.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter(r => r.status === 'rejected')).toHaveLength(1)
  })
  it('外部修改后拒绝覆盖，文件被删除后不创建新文件', async () => {
    await writeFile(join(root, 'test.txt'), 'initial')
    const doc = await service.read(ref, 'test.txt')
    if (doc.kind !== 'text') throw new Error('not text')
    await writeFile(join(root, 'test.txt'), 'external')
    await expect(service.save(ref, 'test.txt', 'draft', doc.version)).rejects.toThrow('files.changedOutside')
    expect(await readFile(join(root, 'test.txt'), 'utf8')).toBe('external')
    await rm(join(root, 'test.txt'))
    await expect(service.save(ref, 'test.txt', 'draft', doc.version)).rejects.toThrow('files.notFound')
  })
  it('越界相对路径、绝对路径和项目外链接均被拦下', async () => {
    await mkdir(join(folder, 'outside'))
    await writeFile(join(folder, 'outside', 'secret.txt'), 'outside')
    await symlink(join(folder, 'outside'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(workspacePath(root, '../outside/secret.txt')).rejects.toThrow('files.outsideProject')
    await expect(workspacePath(root, join(folder, 'outside/secret.txt'))).rejects.toThrow('files.relativePath')
    await expect(workspacePath(root, 'linked/secret.txt')).rejects.toThrow('链接指向项目外')
    expect(() => workspaceRef({ projectId: 'p', sessionId: 's' })).toThrow('目标不正确')
  })
  it('二进制、非法编码与大文件给限制提示，图片给独立预览', async () => {
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(root, 'legacy.txt'), Buffer.from([255, 254, 65]))
    await writeFile(join(root, 'large.txt'), Buffer.alloc(TEXT_LIMIT + 1, 65))
    await writeFile(join(root, 'pic.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(await service.read(ref, 'binary.bin')).toMatchObject({ kind: 'unsupported' })
    expect(await service.read(ref, 'legacy.txt')).toMatchObject({ kind: 'unsupported' })
    const large = await service.read(ref, 'large.txt')
    expect(large).toMatchObject({ kind: 'text', readonly: true })
    if (large.kind === 'text')
      await expect(service.save(ref, 'large.txt', 'small', large.version)).rejects.toThrow('文件已变化')
    await writeFile(join(root, 'huge.txt'), Buffer.alloc(READ_LIMIT + 1, 65))
    expect(await service.read(ref, 'huge.txt')).toMatchObject({
      kind: 'unsupported',
      reason: '文件太大，请用外部编辑器打开',
    })
    expect(await service.read(ref, 'pic.png')).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    })
  })
  it('Git 标记以项目为准，兼容项目位于仓库子目录', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true })
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', 'tracked.txt'), 'before')
    execFileSync('git', ['add', 'sub/tracked.txt'], { cwd: root, windowsHide: true })
    await writeFile(join(root, 'sub', 'tracked.txt'), 'after')
    await writeFile(join(root, 'sub', 'new.txt'), 'new')
    const nested = new WorkspaceFiles(value => ({ ref: value, name: 'sub', path: join(root, 'sub') }))
    const status = await nested.status(ref)
    expect(status['tracked.txt']).toBe('A')
    expect(status['new.txt']).toBe('?')
    expect(Object.keys(status).some(p => p.startsWith('sub/'))).toBe(false)
  })
  it('读取 HEAD 内容兼容子目录项目；未跟踪、不在 Git 及越界不会读出内容', async () => {
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', '文件 (1).txt'), 'original\r\n')
    expect(await service.headContent(ref, 'sub/文件 (1).txt')).toBeNull()
    execFileSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true })
    execFileSync('git', ['add', '.'], { cwd: root, windowsHide: true })
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'],
      { cwd: root, windowsHide: true },
    )
    await writeFile(join(root, 'sub', '文件 (1).txt'), 'modified\n')
    const nested = new WorkspaceFiles(value => ({ ref: value, name: 'sub', path: join(root, 'sub') }))
    expect(await nested.headContent(ref, '文件 (1).txt')).toBe('original\n')
    await writeFile(join(root, 'new.txt'), 'new')
    expect(await service.headContent(ref, 'new.txt')).toBeNull()
    await expect(nested.headContent(ref, '../new.txt')).rejects.toThrow('files.outsideProject')
  })
  it('HEAD 里是 Git LFS 指针时按 .gitattributes 换成真正的内容；扩展名是图片、内容不是时按普通文件显示', async () => {
    // 用一个假的过滤器代替 git-lfs（测试机不一定装了）：clean 原样存，smudge 输出真正的内容
    const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + '0'.repeat(64) + '\nsize 5\n'
    const run = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true })
    run('init', '--quiet')
    run('config', 'filter.fake.clean', 'cat')
    run('config', 'filter.fake.smudge', 'echo smudged')
    await writeFile(join(root, '.gitattributes'), 'data.txt filter=fake\n')
    await writeFile(join(root, 'data.txt'), pointer)
    await writeFile(join(root, 'fake.png'), 'not really a png')
    run('add', '.')
    run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture')
    expect(await service.headContent(ref, 'data.txt')).toBe('smudged\n')
    expect(await service.read(ref, 'fake.png')).toMatchObject({ kind: 'text', content: 'not really a png' })
  })
  it('HEAD 里是 Git LFS 指针且真实大小超过读取上限时不去换', async () => {
    const run = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true })
    run('init', '--quiet')
    run('config', 'filter.fake.clean', 'cat')
    run('config', 'filter.fake.smudge', 'echo smudged')
    const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + '0'.repeat(64) + '\nsize 99999999999\n'
    await writeFile(join(root, '.gitattributes'), 'data.txt filter=fake\n')
    await writeFile(join(root, 'data.txt'), pointer)
    run('add', '.')
    run('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture')
    // 没去换：还是指针原文（换了会得到 smudged）
    expect(await service.headContent(ref, 'data.txt')).toBe(pointer)
  })
})

describe('多文件夹项目（docs/ui/multi-root-projects.md §3.4）', () => {
  let extra: string, multi: WorkspaceFiles
  beforeEach(async () => {
    extra = join(folder, '附加 文件夹')
    await mkdir(join(extra, 'src'), { recursive: true })
    await writeFile(join(extra, 'src', 'a.ts'), 'export const 银河 = 1\n')
    await writeFile(join(root, 'main.ts'), 'const 银河 = 0\n')
    multi = new WorkspaceFiles(
      value => ({ ref: value, name: '测试项目', path: root, folders: [{ path: extra, name: '附加' }] }),
      { trash: async () => {} },
    )
  })

  it('「::1/…」读写附加文件夹，不带前缀的还是主文件夹；没有的文件夹编号报找不到', async () => {
    expect((await multi.list(ref, '::1')).entries.map(e => e.path)).toEqual(['::1/src'])
    expect((await multi.list(ref, '::1/src')).entries.map(e => e.path)).toEqual(['::1/src/a.ts'])
    expect((await multi.list(ref, '')).entries.map(e => e.path)).toEqual(['main.ts'])
    const doc = await multi.read(ref, '::1/src/a.ts')
    expect(doc).toMatchObject({ kind: 'text', path: '::1/src/a.ts', content: 'export const 银河 = 1\n' })
    if (doc.kind !== 'text') throw new Error('not text')
    await multi.save(ref, '::1/src/a.ts', 'changed\n', doc.version)
    expect(await readFile(join(extra, 'src', 'a.ts'), 'utf8')).toBe('changed\n')
    await expect(multi.read(ref, '::2/x.ts')).rejects.toThrow('files.notFound')
    // 附加文件夹里同样不能越界
    await expect(multi.read(ref, '::1/../中文 & 项目 (1)/main.ts')).rejects.toThrow()
  })

  it('新建、重命名带回前缀；不能在主文件夹和附加文件夹之间移动', async () => {
    expect(await multi.create(ref, '::1/src/b.ts', 'file')).toEqual({ path: '::1/src/b.ts' })
    expect(await multi.rename(ref, '::1/src/b.ts', '::1/src/c.ts')).toEqual({ path: '::1/src/c.ts' })
    await expect(multi.rename(ref, '::1/src/c.ts', 'c.ts')).rejects.toThrow('files.outsideProject')
    await multi.remove(ref, '::1/src/c.ts')
  })

  it('按名字搜、内容搜、Git 标记都包括附加文件夹', async () => {
    expect((await multi.search(ref, 'a.ts')).entries.map(e => e.path)).toEqual(['::1/src/a.ts'])
    const found = await multi.grep(ref, '银河')
    expect(found.matches.map(m => m.path).sort()).toEqual(['::1/src/a.ts', 'main.ts'])
    execFileSync('git', ['init', '-q'], { cwd: extra, windowsHide: true })
    expect((await multi.status(ref))['::1/src/']).toBeUndefined()
    expect(Object.keys(await multi.status(ref))).toContain('::1/src')
  })

  it('附加文件夹不在了：按名字搜跳过它，主文件夹照样搜；主文件夹不在了才报错（#85）', async () => {
    const gone = new WorkspaceFiles(value => ({
      ref: value,
      name: '测试项目',
      path: root,
      folders: [
        { path: join(folder, '已删掉'), name: '没了' },
        { path: extra, name: '附加' },
      ],
    }))
    expect((await gone.search(ref, 'main')).entries.map(e => e.path)).toEqual(['main.ts'])
    expect((await gone.search(ref, 'a.ts')).entries.map(e => e.path)).toEqual(['::2/src/a.ts'])
    const noMain = new WorkspaceFiles(value => ({
      ref: value,
      name: '测试项目',
      path: join(folder, '已删掉'),
      folders: [{ path: extra, name: '附加' }],
    }))
    await expect(noMain.search(ref, 'a.ts')).rejects.toThrow('项目目录不存在')
  })
})

describe('项目外的文件「::0/完整路径」（docs/ui/outside-files.md）', () => {
  it('以文件所在的文件夹为根读写、列目录，返回的路径带回「::0/文件夹/」；不是完整路径的报找不到', async () => {
    const outside = join(folder, '项目外 文件夹')
    await mkdir(join(outside, 'sub'), { recursive: true })
    await writeFile(join(outside, 'sub', 'a.java'), 'class A {}\n')
    const shown = (p: string): string => '::0/' + p.replaceAll('\\', '/')
    const file = shown(join(outside, 'sub', 'a.java'))
    const doc = await service.read(ref, file)
    expect(doc).toMatchObject({ kind: 'text', path: file, content: 'class A {}\n' })
    if (doc.kind !== 'text') throw new Error('not text')
    await service.save(ref, file, 'class B {}\n', doc.version)
    expect(await readFile(join(outside, 'sub', 'a.java'), 'utf8')).toBe('class B {}\n')
    expect((await service.list(ref, shown(outside))).entries.map(e => e.path)).toEqual([shown(join(outside, 'sub'))])
    await expect(service.read(ref, '::0/relative/a.java')).rejects.toThrow('files.notFound')
    await expect(service.read(ref, '::0/')).rejects.toThrow('files.notFound')
  })
})

describe('编辑器参数', () => {
  it('中文与 shell 特殊字符作为参数原样传入，文件定位保留盘符', () => {
    expect(editorArgs('code', 'reuse', 'D:\\中文 & 项目', 'D:\\中文 & 项目\\file.ts', 10, 4)).toEqual([
      '--reuse-window',
      'D:\\中文 & 项目',
      '--goto',
      'D:\\中文 & 项目\\file.ts:10:4',
    ])
    expect(editorArgs('code', 'new', 'D:\\项目')).toEqual(['--new-window', 'D:\\项目'])
    expect(editorArgs('folder', 'new', 'D:\\项目', 'D:\\项目\\file.txt')).toEqual(['D:\\项目\\file.txt'])
    expect(() => editorArgs('code', 'reuse', root, 'file.ts', -1)).toThrow('行列不正确')
  })
  // 会真的检测已装的编辑器（注册表、PowerShell、PATH 和各盘符），GitHub 的 Windows 机器上要 5 秒以上
  it('自定义程序用参数数组启动，偏好重启恢复，不继承 Electron Node 模式', { timeout: 30_000 }, async () => {
    const program = join(root, 'launcher.cjs'),
      log = join(folder, 'launch-result.json')
    await writeFile(
      program,
      `require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({argv:process.argv,mode:process.env.ELECTRON_RUN_AS_NODE}))`,
    )
    const prefs = join(folder, 'prefs')
    await mkdir(prefs)
    await writeFile(
      join(prefs, 'editor-settings.json'),
      JSON.stringify({
        defaultId: 'custom:test',
        window: 'new',
        custom: [{ id: 'custom:test', name: '测试编辑器', kind: 'custom', path: process.execPath, mode: 'folder' }],
      }),
    )
    const editor = new Editors(prefs, value => ({ ref: value, name: 'project', path: root }))
    await editor.init()
    expect((await editor.state()).defaultId).toBe('custom:test')
    expect((await editor.state()).openWith).toBe('app')
    const previous = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      await editor.open(ref, undefined, 'launcher.cjs')
    } finally {
      if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE
      else process.env.ELECTRON_RUN_AS_NODE = previous
    }
    let data: { argv: string[]; mode?: string } | null = null
    for (let i = 0; i < 40; i++) {
      try {
        data = JSON.parse(await readFile(log, 'utf8'))
        break
      } catch {
        await new Promise(r => setTimeout(r, 25))
      }
    }
    expect(data?.argv[1]).toBe(program)
    expect(data?.mode).toBeUndefined()
    await editor.preferences({ window: 'reuse' })
    const restarted = new Editors(prefs, value => ({ ref: value, name: 'project', path: root }))
    await restarted.init()
    expect((await restarted.state()).window).toBe('reuse')
  })
  it('Trae 手动路径和默认打开方式保存后重启恢复', async () => {
    const prefs = join(folder, 'trae-prefs')
    const editor = new Editors(prefs, value => ({ ref: value, name: 'project', path: root }))
    await editor.init()
    const configured = await editor.configure('trae-cn', process.execPath)
    expect(configured.items.find(e => e.id === 'trae-cn')).toMatchObject({
      kind: 'trae-cn',
      path: process.execPath,
      manual: true,
      source: 'manual',
    })
    await editor.preferences({ defaultId: 'trae-cn', openWith: 'trae-cn' })
    const restarted = new Editors(prefs, value => ({ ref: value, name: 'project', path: root }))
    await restarted.init()
    const saved = await restarted.state()
    expect(saved.openWith).toBe('trae-cn')
    expect(saved.items.find(e => e.id === saved.defaultId)?.path).toBe(process.execPath)
  }, 10000)
})
