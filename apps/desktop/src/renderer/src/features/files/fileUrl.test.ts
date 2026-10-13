import { describe, expect, it } from 'vitest'
import { fileUrl, isHtmlPath } from './fileUrl'

describe('HTML 在浏览器里预览', () => {
  it('认 .html / .htm，不分大小写', () => {
    expect(isHtmlPath('docs/ui/a.html')).toBe(true)
    expect(isHtmlPath('INDEX.HTM')).toBe(true)
    expect(isHtmlPath('a.html.md')).toBe(false)
  })

  it('Windows 和 Unix 路径拼成 file:// 地址，空格和中文转义，盘符不转', () => {
    expect(fileUrl('D:\\PixelSky', 'docs/ui/sidebar-list-template.html')).toBe(
      'file:///D:/PixelSky/docs/ui/sidebar-list-template.html',
    )
    expect(fileUrl('D:\\My Docs\\', './示例 页.html')).toBe('file:///D:/My%20Docs/%E7%A4%BA%E4%BE%8B%20%E9%A1%B5.html')
    expect(fileUrl('/home/me/proj', 'a#b.html')).toBe('file:///home/me/proj/a%23b.html')
  })
})
