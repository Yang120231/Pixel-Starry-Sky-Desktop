import { validateImages } from '@pixelsky/protocol'
import { describe, expect, it } from 'vitest'
import type { BrowserAnnotation } from '../../../../shared/types/project-browser'
import { isSlashCommand, notesText, shotImage } from './annotationText'

const note = (over: Partial<BrowserAnnotation> = {}): BrowserAnnotation => ({
  id: 'n1',
  text: '加 loading',
  url: 'http://localhost:5173/checkout',
  route: '/checkout',
  selector: 'form.checkout button.primary',
  label: 'button.primary',
  element: '提交订单',
  ...over,
})

describe('发给会话的批注文字', () => {
  it('页头、网址、标题、选择器、意见', () => {
    expect(notesText([note()])).toBe(
      [
        '网页批注（1 条）',
        '网址：http://localhost:5173/checkout',
        '1. button.primary「提交订单」',
        '选择器：form.checkout button.primary',
        '意见：加 loading',
      ].join('\n'),
    )
  })
  it('取消勾选的项不写：元素文字、选择器；路由取消时网址只写到域名', () => {
    const text = notesText([note({ off: ['element', 'selector', 'route'] })])
    expect(text).not.toContain('提交订单')
    expect(text).not.toContain('选择器')
    expect(text).toContain('网址：http://localhost:5173\n')
    expect(text).not.toContain('/checkout')
    expect(text).toContain('1. button.primary\n')
  })
  it('整页批注（没有选择器）写成「序号. 意见」；路由和第一条不同的另写一行', () => {
    const text = notesText([
      note(),
      note({ id: 'n2', route: '/cart', selector: '#cart', label: '#cart' }),
      note({ id: 'n3', selector: undefined, route: undefined, label: undefined, element: undefined, text: '整体偏暗' }),
    ])
    expect(text).toContain('2. #cart「提交订单」\n路由：/cart\n选择器：#cart')
    expect(text).toContain('3. 意见：整体偏暗')
    expect(notesText([])).toBe('')
  })
})

describe('斜杠命令', () => {
  it('以 / 开头（忽略前导空白）算命令', () => {
    expect(isSlashCommand('/compact')).toBe(true)
    expect(isSlashCommand('  /goal x')).toBe(true)
    expect(isSlashCommand('看一下 /tmp')).toBe(false)
    expect(isSlashCommand('')).toBe(false)
  })
})

describe('截图变图片附件', () => {
  // 20 个 base64 字符、没有填充：15 字节
  const shot = 'data:image/jpeg;base64,/9j/4AAQ' + 'AAAA'.repeat(3)
  it('字节数按 base64 算准，能通过输入框的图片校验', () => {
    const image = shotImage(note({ id: 'abc-123', shot, shotSize: { width: 10, height: 5 } }), 2)!
    expect(image).toMatchObject({
      id: 'abc-123',
      name: 'annotation-2.jpg',
      mediaType: 'image/jpeg',
      width: 10,
      bytes: 15,
    })
    expect(() => validateImages([image])).not.toThrow()
  })
  it('没有截图、数据长度不对、不是 JPEG 都返回 null', () => {
    expect(shotImage(note(), 1)).toBeNull()
    expect(shotImage(note({ shot: 'data:image/jpeg;base64,abc', shotSize: { width: 1, height: 1 } }), 1)).toBeNull()
    expect(shotImage(note({ shot: 'data:image/png;base64,AAAA', shotSize: { width: 1, height: 1 } }), 1)).toBeNull()
  })
})
