import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ARTIFACT_TEXT_LIMIT, openable, readArtifact } from './artifact-files'

let root: string
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'artifact-files-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('产物预览读取', () => {
  it('Markdown / HTML / 文本，超过 512KB 截断，去掉 BOM、统一换行', async () => {
    await writeFile(join(root, 'r.md'), '﻿# 标题\r\n内容')
    expect(await readArtifact(join(root, 'r.md'))).toMatchObject({
      kind: 'text',
      format: 'markdown',
      content: '# 标题\n内容',
      truncated: false,
    })
    await writeFile(join(root, 'p.html'), '<h1>x</h1>')
    expect(await readArtifact(join(root, 'p.html'))).toMatchObject({ kind: 'text', format: 'html' })
    await writeFile(join(root, 'big.txt'), 'a'.repeat(ARTIFACT_TEXT_LIMIT + 10))
    const big = await readArtifact(join(root, 'big.txt'))
    expect(big).toMatchObject({ kind: 'text', truncated: true, bytes: ARTIFACT_TEXT_LIMIT + 10 })
    expect(big.kind === 'text' && big.content.length).toBe(ARTIFACT_TEXT_LIMIT)
  })
  it('图片转成 data URL，PDF 单独返回，二进制和不存在的文件给出原因', async () => {
    await writeFile(join(root, 'a.png'), Buffer.from([137, 80, 78, 71]))
    expect(await readArtifact(join(root, 'a.png'))).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,iVBORw==',
    })
    await writeFile(join(root, 'a.pdf'), '%PDF-1.4')
    expect(await readArtifact(join(root, 'a.pdf'))).toMatchObject({ kind: 'pdf', bytes: 8 })
    await writeFile(join(root, 'a.bin'), Buffer.from([0, 1, 2]))
    expect(await readArtifact(join(root, 'a.bin'))).toMatchObject({ kind: 'unsupported', reason: 'binary' })
    expect(await readArtifact(join(root, 'nope.md'))).toEqual({ kind: 'missing' })
    expect(await readArtifact(root)).toEqual({ kind: 'missing' })
  })
  it('默认应用只打开文档类文件，可执行和脚本一律拒绝', () => {
    expect(['a.md', 'b.PDF', 'c.png', 'd.xlsx', 'e.html', 'f.zip', 'g.mp4'].every(openable)).toBe(true)
    expect(
      [
        'a.exe',
        'b.bat',
        'c.cmd',
        'd.ps1',
        'e.vbs',
        'f.js',
        'g.lnk',
        'h.msi',
        'i.hta',
        'j.reg',
        'k.url',
        'l.ts',
        'Makefile',
      ].some(openable),
    ).toBe(false)
  })
})
