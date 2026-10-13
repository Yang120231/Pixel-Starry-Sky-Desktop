import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pageText, pdfText, type PdfJs } from './pdfText'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(here, '__fixtures__', name)))
// 测试里用 Node 版 pdf.js，CMap 从包里直接读
const cMapUrl = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'cmaps') + '/'
const read = (name: string) => pdfText(pdfjs as unknown as PdfJs, fixture(name), { cMapUrl, cMapPacked: true })

describe('PDF', () => {
  it('按页写「## 第 N 页」；每行一行（看纵坐标换行）', async () => {
    expect(await read('latin.pdf')).toEqual({ kind: 'text', text: '## 第 1 页\nHello PDF\nSecond line' })
  })
  it('中文（CID 字体，要 CMap）也能读出来', async () => {
    expect(await read('cjk.pdf')).toEqual({
      kind: 'text',
      text: '## 第 1 页\n第一页标题\n季度收入增长百分之十\n\n## 第 2 页\n第二页',
    })
  })
  it('扫描件（没有文字层）、有打开密码的分别说', async () => {
    expect(await read('scanned.pdf')).toEqual({ kind: 'scanned' })
    expect(await read('locked.pdf')).toEqual({ kind: 'password' })
  })
  it('一页里 pdf.js 没给换行时，纵坐标变了也换行；行尾空白去掉', () => {
    expect(
      pageText([
        { str: '甲 ', transform: [1, 0, 0, 1, 0, 700] },
        { str: '乙', transform: [1, 0, 0, 1, 20, 700] },
        { str: '丙', transform: [1, 0, 0, 1, 0, 680], hasEOL: true },
        { str: '丁', transform: [1, 0, 0, 1, 0, 660] },
      ]),
    ).toBe('甲 乙\n丙\n丁')
  })
})
