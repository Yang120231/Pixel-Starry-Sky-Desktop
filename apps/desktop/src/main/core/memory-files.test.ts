import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryFile } from './memory-files'

describe('上下文明细里的记忆文件', () => {
  let dir = '',
    file = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pixelsky-memory-'))
    file = join(dir, 'CLAUDE.md')
    await writeFile(file, '# memory\n')
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('只放行诊断里列出的、存在的文件', async () => {
    await expect(memoryFile([{ name: file }], file)).resolves.toBe(file)
    // 没列出的：即使存在也不开
    await expect(memoryFile([], file)).rejects.toThrow('只能打开这个会话的记忆文件')
    await expect(memoryFile([{ name: file }], join(dir, 'other.md'))).rejects.toThrow('只能打开')
    // 列出了但已经不在了、是个目录
    const gone = join(dir, 'gone.md')
    await expect(memoryFile([{ name: gone }], gone)).rejects.toThrow('文件不存在')
    await expect(memoryFile([{ name: dir }], dir)).rejects.toThrow('文件不存在')
  })

  it('相对路径、不是字符串的参数不接受', async () => {
    await expect(memoryFile([{ name: 'CLAUDE.md' }], 'CLAUDE.md')).rejects.toThrow('只能打开')
    await expect(memoryFile([{ name: file }], 42)).rejects.toThrow('文件路径不正确')
    await expect(memoryFile([{ name: file }], '')).rejects.toThrow('文件路径不正确')
  })
})
