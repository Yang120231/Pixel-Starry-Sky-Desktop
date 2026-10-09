import { describe, expect, it } from 'vitest'
import { deliveryType } from '../src/artifacts'

describe('deliveryType', () => {
  it('按扩展名归类', () => {
    expect(deliveryType('a.md')).toBe('document')
    expect(deliveryType('a.pdf')).toBe('document')
    expect(deliveryType('a.docx')).toBe('document')
    expect(deliveryType('a.png')).toBe('image')
    expect(deliveryType('a.svg')).toBe('image')
    expect(deliveryType('a.csv')).toBe('table')
    expect(deliveryType('a.xlsx')).toBe('table')
    expect(deliveryType('a.html')).toBe('web')
    expect(deliveryType('a.htm')).toBe('web')
    expect(deliveryType('a.zip')).toBe('archive')
    expect(deliveryType('a.tgz')).toBe('archive')
    expect(deliveryType('a.mp4')).toBe('media')
    expect(deliveryType('a.m4a')).toBe('media')
  })
  it('扩展名不区分大小写', () => {
    expect(deliveryType('REPORT.PDF')).toBe('document')
    expect(deliveryType('Photo.JpG')).toBe('image')
  })
  it('源码、配置和未知扩展名返回 null', () => {
    expect(deliveryType('a.ts')).toBeNull()
    expect(deliveryType('package.json')).toBeNull()
    expect(deliveryType('a.unknown')).toBeNull()
  })
  it('无扩展名、以点开头的隐藏文件、空串、以斜杠结尾返回 null', () => {
    expect(deliveryType('Makefile')).toBeNull()
    expect(deliveryType('.md')).toBeNull()
    expect(deliveryType('')).toBeNull()
    expect(deliveryType('dir/')).toBeNull()
  })
  it('支持 Windows 与 POSIX 路径，只看最后一段；多个点取最后一个', () => {
    expect(deliveryType('C:\\work\\out\\report.xlsx')).toBe('table')
    expect(deliveryType('/tmp/a.b/readme.md')).toBe('document')
    expect(deliveryType('x.y/noext')).toBeNull()
    expect(deliveryType('archive.tar.gz')).toBe('archive')
    expect(deliveryType('a.png.ts')).toBeNull()
  })
})
