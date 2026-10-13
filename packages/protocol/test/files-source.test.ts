import { describe, expect, it } from 'vitest'
import { fileAttachmentBlock, validateFiles } from '../src/files'
import type { FileAttachment } from '../src/types'

describe('从文档提取的文字（source）', () => {
  const doc = (patch: Partial<FileAttachment>): FileAttachment => ({
    id: 'd1',
    name: '方案.docx',
    bytes: 20_000,
    lines: 3,
    encoding: 'utf-8',
    text: '甲\n乙\n丙\n',
    source: 'docx',
    ...patch,
  })

  it('认识的 source 留着，不认识的拒；发给引擎时写明原文件是什么', () => {
    expect(validateFiles([doc({})])[0].source).toBe('docx')
    expect(() => validateFiles([doc({ source: 'exe' as never })])).toThrow('文件附件格式不正确')
    expect(fileAttachmentBlock(doc({}))).toMatch(
      /^<attached_file name="方案.docx" size="20 KB" lines="3" source="Word document" note="/,
    )
  })

  it('只留开头时（tail 为空）只写带了前几行、后面省略多少', () => {
    const block = fileAttachmentBlock(doc({ lines: 10, text: '甲\n乙\n', tail: '', omitted: 8 }))
    expect(block).toContain('shown="1-2">')
    expect(block.endsWith('乙\n[... 8 more lines omitted (3-10) ...]\n</attached_file>')).toBe(true)
  })
})
