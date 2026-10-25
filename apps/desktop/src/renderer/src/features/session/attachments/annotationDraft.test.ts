import type { ImageAttachment } from '@pixelsky/protocol'
import { describe, expect, it } from 'vitest'
import type { BrowserAnnotation } from '../../../../../shared/types/project-browser'
import {
  composeWithAnnotations,
  getAnnotationDraft,
  removeAnnotationDraft,
  setAnnotationDraft,
  takeRemovedNotes,
  type AnnotationDraft,
} from './annotationDraft'

const image = (id: string): ImageAttachment => ({
  id,
  name: id + '.jpg',
  mediaType: 'image/jpeg',
  bytes: 3,
  width: 1,
  height: 1,
  dataBase64: 'AAAA',
})
const draft = (shots: number): AnnotationDraft => ({
  url: 'http://localhost:5173/checkout',
  notes: [
    {
      id: 'n1',
      text: '加 loading',
      url: 'http://localhost:5173/checkout',
      route: '/checkout',
      selector: 'button.primary',
      label: 'button.primary',
    } satisfies BrowserAnnotation,
  ],
  shots: Array.from({ length: shots }, (_, i) => image('shot' + i)),
})

describe('发送时合并批注卡', () => {
  it('文字块接在用户的话后面，截图排在已有图片后面', () => {
    const out = composeWithAnnotations('按这几条改一下', [image('own')], draft(2))
    expect(out.sent).toBe(true)
    expect(out.text.startsWith('按这几条改一下\n\n网页批注（1 条）\n')).toBe(true)
    expect(out.images.map(i => i.id)).toEqual(['own', 'shot0', 'shot1'])
  })
  it('用户没写话时只发批注文字块', () => {
    expect(composeWithAnnotations('  ', [], draft(0)).text.startsWith('网页批注（1 条）')).toBe(true)
  })
  it('斜杠命令原样发：不拼文字、不带截图、卡片保留（sent=false）', () => {
    const own = [image('own')]
    const out = composeWithAnnotations('/compact', own, draft(2))
    expect(out).toEqual({ text: '/compact', images: own, sent: false })
  })
  it('一条消息最多 5 张图：放不下的截图只发文字', () => {
    const out = composeWithAnnotations('x', [image('a'), image('b'), image('c'), image('d')], draft(3))
    expect(out.images.map(i => i.id)).toEqual(['a', 'b', 'c', 'd', 'shot0'])
    expect(
      composeWithAnnotations(
        'x',
        [1, 2, 3, 4, 5].map(n => image('o' + n)),
        draft(2),
      ).images,
    ).toHaveLength(5)
  })
  it('没有批注卡时什么都不改', () => {
    expect(composeWithAnnotations('hi', [], null)).toEqual({ text: 'hi', images: [], sent: false })
  })
})

describe('移除批注卡后 6 秒内可放回', () => {
  it('移除后能取回一次，超过 6 秒或没有卡片时取不到', () => {
    setAnnotationDraft('s1', draft(1))
    removeAnnotationDraft('s1')
    expect(getAnnotationDraft('s1')).toBeNull()
    expect(takeRemovedNotes('s1')?.map(n => n.id)).toEqual(['n1'])
    expect(takeRemovedNotes('s1')).toBeNull()
    setAnnotationDraft('s2', draft(0))
    removeAnnotationDraft('s2')
    expect(takeRemovedNotes('s2', Date.now() + 7000)).toBeNull()
    removeAnnotationDraft('none')
    expect(takeRemovedNotes('none')).toBeNull()
  })
})
