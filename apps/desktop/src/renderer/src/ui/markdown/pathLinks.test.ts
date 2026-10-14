import { describe, expect, it } from 'vitest'
import { keepLocalPaths, linkPathText, maybePath } from './pathLinks'

describe('maybePath', () => {
  it('像文件路径的行内代码才去查', () => {
    expect(maybePath('src/main.ts')).toBe(true)
    expect(maybePath('src/a.ts:12')).toBe(true)
    expect(maybePath('src/a.ts:12:4')).toBe(true)
    expect(maybePath('Program.cs(10,5)')).toBe(true)
    expect(maybePath('README.md')).toBe(true)
  })

  it('命令、普通单词、版本号、太长的不查', () => {
    expect(maybePath('npm install')).toBe(false)
    expect(maybePath('useState')).toBe(false)
    expect(maybePath('1.2.3')).toBe(false)
    expect(maybePath('a'.repeat(300) + '.ts')).toBe(false)
  })
})

describe('linkPathText', () => {
  it('本地文件链接换成「路径:行:列」', () => {
    expect(linkPathText('src/a.ts')).toBe('src/a.ts')
    expect(linkPathText('./src/a.ts#L42')).toBe('./src/a.ts:42')
    expect(linkPathText('src/a.ts#L42C7')).toBe('src/a.ts:42:7')
    expect(linkPathText('src/a.ts#L10-L20')).toBe('src/a.ts:10')
    expect(linkPathText('docs/%E8%AF%B4%E6%98%8E.md')).toBe('docs/说明.md')
    expect(linkPathText('file:///D:/repo/src/a.ts')).toBe('D:/repo/src/a.ts')
    expect(linkPathText('file:///home/me/a.ts')).toBe('/home/me/a.ts')
    expect(linkPathText('D:\\repo\\a.ts')).toBe('D:\\repo\\a.ts')
  })

  it('Codex 的 /E:/… 写法：盘符前面多的 / 去掉；空格（%20）还原', () => {
    expect(linkPathText('/E:/mods/proj/build/index.html')).toBe('E:/mods/proj/build/index.html')
    expect(linkPathText('/E:/mods/AE2%201.20%20GTL/a.java#L12')).toBe('E:/mods/AE2 1.20 GTL/a.java:12')
    expect(linkPathText('/home/me/a.ts')).toBe('/home/me/a.ts')
  })

  it('网址、页内锚点、空地址不算', () => {
    expect(linkPathText('https://example.com/a.ts')).toBeNull()
    expect(linkPathText('mailto:me@example.com')).toBeNull()
    expect(linkPathText('#section')).toBeNull()
    expect(linkPathText('//cdn.example.com/a.js')).toBeNull()
    expect(linkPathText(undefined)).toBeNull()
  })
})

describe('keepLocalPaths', () => {
  it('盘符路径、file: 原样留下，网址按默认放行，其他协议清掉', () => {
    expect(keepLocalPaths(String.raw`D:\PixelSky\a.png`)).toBe(String.raw`D:\PixelSky\a.png`)
    // Markdown 解析后 \ 变成 %5C：保留，再还原成和行内代码一样的路径去查
    expect(keepLocalPaths('D:%5CPixelSky%5Cdocs%5Ca.png')).toBe('D:%5CPixelSky%5Cdocs%5Ca.png')
    expect(linkPathText('D:%5CPixelSky%5Cdocs%5Ca.png')).toBe(String.raw`D:\PixelSky\docs\a.png`)
    expect(keepLocalPaths('C:/x/a.ts')).toBe('C:/x/a.ts')
    expect(keepLocalPaths('file:///D:/x/a.ts')).toBe('file:///D:/x/a.ts')
    expect(keepLocalPaths('https://example.com/a')).toBe('https://example.com/a')
    expect(keepLocalPaths('src/a.ts#L3')).toBe('src/a.ts#L3')
    expect(keepLocalPaths('javascript:alert(1)')).toBe('')
  })
})
