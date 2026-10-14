import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listImportCandidates } from './importProjects'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pixelsky-import-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const dir = (name: string, files: string[] = []): string => {
  const path = join(root, name)
  mkdirSync(path)
  for (const file of files)
    if (file.endsWith('/')) mkdirSync(join(path, file))
    else writeFileSync(join(path, file), '')
  return path
}

describe('listImportCandidates', () => {
  it('只列一层子文件夹，标出像项目的和已添加的；跳过隐藏、node_modules 和文件', async () => {
    const app = dir('app', ['package.json'])
    dir('repo', ['.git/'])
    dir('notes', ['readme.md'])
    dir('dotnet', ['Tool.sln'])
    dir('.cache', ['package.json'])
    dir('node_modules', ['package.json'])
    writeFileSync(join(root, 'file.txt'), '')
    const result = await listImportCandidates(root, [app.toUpperCase()], p => p.toLowerCase())
    expect(result.parent).toBe(root)
    expect(result.truncated).toBe(false)
    expect(result.candidates.map(c => [c.name, c.project, c.added])).toEqual([
      ['app', true, true],
      ['dotnet', true, false],
      ['notes', false, false],
      ['repo', true, false],
    ])
    expect(result.candidates[0].path).toBe(app)
  })

  it('空文件夹：没有候选', async () => {
    expect((await listImportCandidates(root, [])).candidates).toEqual([])
  })

  it('上级文件夹不存在时报错', async () => {
    await expect(listImportCandidates(join(root, 'missing'), [])).rejects.toThrow()
  })
})
