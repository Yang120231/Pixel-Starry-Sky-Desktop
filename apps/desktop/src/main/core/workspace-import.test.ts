// 从系统拖进来＝复制进项目（docs/ui/file-tree-external-drop.md §3.1）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMPORT_CONFIRM_FILES, WorkspaceFiles } from './workspace-files'

vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, cp: vi.fn(real.cp) }
})

let folder: string, root: string, outside: string, service: WorkspaceFiles
const ref = { projectId: 'project' }
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'pixelsky-import-'))
  root = join(folder, '项目')
  outside = join(folder, '外面')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(outside)
  service = new WorkspaceFiles(value => ({ ref: value, name: '项目', path: root }))
})
afterEach(async () => {
  vi.mocked(fsp.cp).mockClear()
  await rm(folder, { recursive: true, force: true, maxRetries: 3 })
})

describe('WorkspaceFiles.importPaths', () => {
  it('复制文件和文件夹进目标文件夹，内容和修改时间照旧，返回相对路径', async () => {
    await writeFile(join(outside, 'lib.jar'), 'jar-bytes')
    const old = new Date('2020-01-02T03:04:05Z')
    await utimes(join(outside, 'lib.jar'), old, old)
    await mkdir(join(outside, 'assets', 'img'), { recursive: true })
    await writeFile(join(outside, 'assets', 'img', 'a.png'), 'png')
    const result = await service.importPaths(ref, 'src', [join(outside, 'lib.jar'), join(outside, 'assets')])
    expect(result).toEqual({ paths: ['src/lib.jar', 'src/assets'], skipped: 0 })
    expect(await readFile(join(root, 'src', 'lib.jar'), 'utf8')).toBe('jar-bytes')
    expect((await stat(join(root, 'src', 'lib.jar'))).mtimeMs).toBe(old.getTime())
    expect(await readFile(join(root, 'src', 'assets', 'img', 'a.png'), 'utf8')).toBe('png')
  })

  it('有同名（含同一批重名）整批不写，一次列出所有重名', async () => {
    await writeFile(join(root, 'a.jar'), 'mine')
    await writeFile(join(outside, 'a.jar'), 'theirs')
    await writeFile(join(outside, 'b.txt'), 'b')
    await mkdir(join(outside, 'x'))
    await writeFile(join(outside, 'x', 'b.txt'), 'b2')
    await expect(
      service.importPaths(ref, '', [join(outside, 'a.jar'), join(outside, 'b.txt'), join(outside, 'x', 'b.txt')]),
    ).rejects.toThrow(/files\.exists.*a\.jar、b\.txt/)
    expect(await readFile(join(root, 'a.jar'), 'utf8')).toBe('mine')
    expect(await readdir(root)).toEqual(['a.jar', 'src'])
  })

  it('目标在源里面（把项目所在的文件夹拖进项目）拒绝', async () => {
    await expect(service.importPaths(ref, 'src', [folder])).rejects.toThrow('files.outsideProject')
  })

  it('源本身是链接跳过；文件夹里的链接跳过、不跟随', async () => {
    const secret = join(folder, 'secret')
    await mkdir(secret)
    await writeFile(join(secret, 'key'), 'k')
    await mkdir(join(outside, 'pkg'))
    await writeFile(join(outside, 'pkg', 'ok.txt'), 'ok')
    try {
      await symlink(secret, join(outside, 'pkg', 'link'), 'junction')
      await symlink(secret, join(outside, 'top-link'), 'junction')
    } catch {
      return // 建不了链接的环境
    }
    const result = await service.importPaths(ref, '', [join(outside, 'pkg'), join(outside, 'top-link')])
    expect(result).toEqual({ paths: ['pkg'], skipped: 2 })
    expect(await readdir(join(root, 'pkg'))).toEqual(['ok.txt'])
  })

  it('复制到一半失败：这次写进去的全删掉，报错说的是正在复制的那一项', async () => {
    await writeFile(join(outside, 'one.txt'), '1')
    await writeFile(join(outside, 'two.txt'), '2')
    const real = vi.mocked(fsp.cp).getMockImplementation()!
    vi.mocked(fsp.cp)
      .mockImplementationOnce(real)
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY', path: join(outside, 'two.txt') })
      })
    await expect(service.importPaths(ref, 'src', [join(outside, 'one.txt'), join(outside, 'two.txt')])).rejects.toThrow(
      /files\.busy.*two\.txt/,
    )
    expect(await readdir(join(root, 'src'))).toEqual([])
  })

  it('回归：检查完到复制前别处建了同名文件：报重名，别人的文件不删、内容不变', async () => {
    await writeFile(join(outside, 'one.txt'), '1')
    await writeFile(join(outside, 'two.txt'), 'mine')
    const real = vi.mocked(fsp.cp).getMockImplementation()!
    vi.mocked(fsp.cp)
      .mockImplementationOnce(real)
      .mockImplementationOnce(async (...args) => {
        await writeFile(join(root, 'src', 'two.txt'), 'theirs')
        return real(...args)
      })
    await expect(service.importPaths(ref, 'src', [join(outside, 'one.txt'), join(outside, 'two.txt')])).rejects.toThrow(
      /files\.exists.*two\.txt/,
    )
    expect(await readdir(join(root, 'src'))).toEqual(['two.txt'])
    expect(await readFile(join(root, 'src', 'two.txt'), 'utf8')).toBe('theirs')
  })

  it('回归：撞名发生在自己新建的文件夹里面（大小写不同的两个文件进不分大小写的盘）：文件夹照常回滚，不当成别人的', async () => {
    await mkdir(join(outside, 'pkg'))
    await writeFile(join(outside, 'pkg', 'README.md'), 'x')
    vi.mocked(fsp.cp).mockImplementationOnce(async (_src, dest) => {
      await mkdir(String(dest))
      await writeFile(join(String(dest), 'README.md'), 'x')
      throw Object.assign(new Error('exists'), { code: 'ERR_FS_CP_EEXIST', path: join(String(dest), 'readme.md') })
    })
    await expect(service.importPaths(ref, 'src', [join(outside, 'pkg')])).rejects.toThrow('exists')
    expect(await readdir(join(root, 'src'))).toEqual([])
  })

  it(`超过 ${IMPORT_CONFIRM_FILES} 个文件又没确认：只返回数量，什么都不写；确认后照常复制`, async () => {
    const big = join(outside, 'big')
    await mkdir(big)
    await Promise.all(Array.from({ length: IMPORT_CONFIRM_FILES + 1 }, (_, i) => writeFile(join(big, `${i}`), '')))
    expect(await service.importPaths(ref, '', [big])).toEqual({
      confirm: { files: IMPORT_CONFIRM_FILES + 1, bytes: 0 },
    })
    expect(await readdir(root)).toEqual(['src'])
    // 真复制几千个文件太慢，复制本身第一条已经测过
    vi.mocked(fsp.cp).mockResolvedValueOnce(undefined)
    expect(await service.importPaths(ref, '', [big], true)).toEqual({ paths: ['big'], skipped: 0 })
    expect(fsp.cp).toHaveBeenCalledOnce()
    expect(fsp.cp).toHaveBeenCalledWith(big, expect.stringMatching(/项目[\\/]big$/), expect.anything())
  }, 60_000)

  it('参数不对：不是绝对路径、网络路径、空列表都拒绝', async () => {
    await expect(service.importPaths(ref, '', [])).rejects.toThrow('参数不正确')
    await expect(service.importPaths(ref, '', ['rel/a.txt'])).rejects.toThrow('参数不正确')
    await expect(service.importPaths(ref, '', ['\\\\host\\share\\a.txt'])).rejects.toThrow('参数不正确')
  })

  it.skipIf(process.platform === 'win32')(
    '回归：名字里带 \\ 的文件（macOS / Linux 允许）拒绝，不会被当成路径复制进子文件夹',
    async () => {
      await mkdir(join(root, 'a'))
      await writeFile(join(outside, 'a\\b.txt'), 'x')
      await expect(service.importPaths(ref, '', [join(outside, 'a\\b.txt')])).rejects.toThrow('files.invalidName')
      expect(await readdir(join(root, 'a'))).toEqual([])
    },
  )
})
