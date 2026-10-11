// 读文本文件附件（docs/ui/composer-file-attachments.md §2）
import { describe, expect, it } from 'vitest'
import { fileAttachmentBlock, fileShownLines, validateFiles } from '@pixelsky/protocol'
import { estimateTokens, isImageFile, looksSecret, readTextFile } from './files'

const file = (parts: BlobPart[], name = 'app.log', type = '') => new File(parts, name, { type })
const lines = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${from + i}`).join('\n')

describe('小文件：整个读', () => {
  it('UTF-8，换行统一成 \\n，最后一行没有换行也算', async () => {
    const f = await readTextFile(file(['ERROR a\r\nWARN b\r\nINFO c']))
    expect(f).toMatchObject({ name: 'app.log', encoding: 'utf-8', lines: 3, text: 'ERROR a\nWARN b\nINFO c' })
    expect(f.tail).toBeUndefined()
    expect(validateFiles([f])).toEqual([f])
  })

  it('不是 UTF-8 的按 GB18030 读（中文 Windows 上的日志）', async () => {
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x0a]) // 「中文\n」
    expect(await readTextFile(file([gbk]))).toMatchObject({ encoding: 'gb18030', text: '中文\n', lines: 1 })
  })

  it('UTF-16（PowerShell 重定向出来的）按 BOM 读', async () => {
    const text = 'PS 输出\nok\n'
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) & 255
      bytes[3 + i * 2] = text.charCodeAt(i) >> 8
    }
    expect(await readTextFile(file([bytes]))).toMatchObject({ encoding: 'utf-16le', text, lines: 2 })
  })

  it('二进制、PDF 不收，报错里带文件名', async () => {
    await expect(readTextFile(file([new Uint8Array([1, 2, 0, 3])], 'a.bin'))).rejects.toThrow('a.bin')
    await expect(readTextFile(file(['%PDF-1.7\n...'], 'r.pdf'))).rejects.toThrow('r.pdf')
  })
})

describe('大文件：只带开头和结尾', () => {
  it('开头截到整行、结尾从整行开始，行数数的是整个文件', async () => {
    const f = await readTextFile(file([lines(200_000) + '\n']))
    expect(f.lines).toBe(200_000)
    expect(f.text.startsWith('line 1\n')).toBe(true)
    expect(f.text.endsWith('\n')).toBe(true)
    expect(f.tail!.endsWith('line 200000\n')).toBe(true)
    expect(f.tail!.startsWith('line ')).toBe(true)
    const shown = fileShownLines(f)
    expect(shown.head + shown.tail + f.omitted!).toBe(200_000)
    // 结尾第一行正好接在省略的那些行后面
    expect(f.tail!.split('\n')[0]).toBe(`line ${200_000 - shown.tail + 1}`)
    expect(f.text.length + f.tail!.length).toBeLessThanOrEqual(100 * 1024)
    expect(fileAttachmentBlock(f)).toContain(`lines omitted (${shown.head + 1}-${200_000 - shown.tail})`)
    expect(validateFiles([f])).toEqual([f])
  })

  it('最后一行没有换行也算一行', async () => {
    const f = await readTextFile(file([lines(50_000)]))
    expect(f.lines).toBe(50_000)
    expect(f.tail!.endsWith('line 50000')).toBe(true)
    expect(fileShownLines(f).head + fileShownLines(f).tail + f.omitted!).toBe(50_000)
  })

  it('UTF-16 的大文件：按两个字节一个换行截、数行', async () => {
    const text = lines(30_000) + '\n'
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i)
    const f = await readTextFile(file([bytes]))
    expect(f).toMatchObject({ encoding: 'utf-16le', lines: 30_000 })
    expect(f.text.startsWith('line 1\n')).toBe(true)
    expect(f.tail!.endsWith('line 30000\n')).toBe(true)
    const shown = fileShownLines(f)
    expect(f.tail!.split('\n')[0]).toBe(`line ${30_000 - shown.tail + 1}`)
  })

  it('太大的直接拒', async () => {
    const big = { size: 51 * 1024 * 1024, name: 'huge.log' } as File
    await expect(readTextFile(big)).rejects.toThrow('huge.log')
  })
})

describe('其他', () => {
  it('图片按类型或扩展名分出去', () => {
    expect(isImageFile(file([''], 'a.png', 'image/png'))).toBe(true)
    expect(isImageFile(file([''], 'shot.JPG'))).toBe(true)
    expect(isImageFile(file([''], 'a.svg', 'image/svg+xml'))).toBe(false)
    expect(isImageFile(file([''], 'app.log'))).toBe(false)
  })

  it('像放密钥的文件名', () => {
    for (const name of ['.env', '.env.local', 'server.pem', 'id_ed25519', 'aws-credentials.json'])
      expect(looksSecret(name)).toBe(true)
    for (const name of ['app.log', 'environment.md', 'keyboard.ts']) expect(looksSecret(name)).toBe(false)
  })

  it('token 估算：英文约 4 字符一个，中文一个字一个', () => {
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('中文')).toBe(2)
  })
})
