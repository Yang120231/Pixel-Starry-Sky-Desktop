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
    await writeFile(join(root, 'pic.png'), Buffer.from([137, 80, 78, 71]))
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
      dataUrl: 'data:image/png;base64,iVBORw==',
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
  it('自定义程序用参数数组启动，偏好重启恢复，不继承 Electron Node 模式', async () => {
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
