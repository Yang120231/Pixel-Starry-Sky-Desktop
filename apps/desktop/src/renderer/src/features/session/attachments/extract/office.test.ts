import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { fileAttachmentBlock, FILE_INLINE_BYTES, validateFiles } from '@pixelsky/protocol'
import { readTextFile } from '../files'
import { columnIndex, compactRows, excelDate, widest } from './xlsx'
import { documentAttachment } from './index'
import { parseXml, textOf } from './xml'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const zip = (files: Record<string, string>, name: string): File =>
  new File([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))], name)
const read = (file: File) => readTextFile(file)
const error = async (file: File): Promise<string> => {
  try {
    await read(file)
  } catch (e) {
    return (e as Error).message
  }
  return ''
}

const p = (text: string, props = ''): string =>
  `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

describe('XML 解析', () => {
  it('元素、属性去掉前缀，实体、CDATA、注释、声明都对', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- x --><a:root b:k="1 &amp; 2"><a:t>甲&lt;乙&#x4e19;</a:t><![CDATA[<raw>]]><e/></a:root>',
    )
    expect(root.name).toBe('root')
    expect(root.attrs.k).toBe('1 & 2')
    expect(textOf(root)).toBe('甲<乙丙<raw>')
  })
})

describe('Word', () => {
  const docx = (body: string, extra: Record<string, string> = {}) =>
    zip(
      {
        '[Content_Types].xml': '<Types/>',
        'word/document.xml': `<w:document ${W}><w:body>${body}</w:body></w:document>`,
        'word/styles.xml': `<w:styles ${W}><w:style w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="a3"><w:name w:val="Title"/></w:style></w:styles>`,
        'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
        ...extra,
      },
      '方案.docx',
    )
  it('标题、段落、有序 / 无序列表、表格、脚注、批注；删除的修订不要', async () => {
    const file = docx(
      p('季度计划', '<w:pStyle w:val="a3"/>') +
        p('目标', '<w:pStyle w:val="1"/>') +
        `<w:p><w:r><w:t>上线</w:t></w:r><w:del><w:r><w:delText>删掉的</w:delText></w:r></w:del><w:r><w:t xml:space="preserve"> 新版</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
        p('第一步', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
        p('第二步', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
        p('要点', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') +
        `<w:tbl><w:tr><w:tc>${p('名称')}</w:tc><w:tc>${p('数量')}</w:tc></w:tr><w:tr><w:tc>${p('a|b')}</w:tc><w:tc>${p('3')}</w:tc></w:tr></w:tbl>`,
      {
        'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1">${p('---')}</w:footnote><w:footnote w:id="1">${p('见附录')}</w:footnote></w:footnotes>`,
        'word/comments.xml': `<w:comments ${W}><w:comment w:id="0" w:author="林夏">${p('再确认一下')}</w:comment></w:comments>`,
      },
    )
    const out = await read(file)
    expect(out.source).toBe('docx')
    expect(out.text).toBe(
      [
        '# 季度计划',
        '# 目标',
        '上线 新版[^1]',
        '1. 第一步',
        '2. 第二步',
        '- 要点',
        '| 名称 | 数量 |\n| --- | --- |\n| a\\|b | 3 |',
        '[^1]: 见附录',
        '## 批注\n- 林夏：再确认一下',
      ].join('\n\n'),
    )
    expect(out.encoding).toBe('utf-8')
    // 发给引擎时标明是从 Word 提取的
    expect(fileAttachmentBlock(out)).toContain('source="Word document"')
    expect(validateFiles([out])[0].source).toBe('docx')
  })
  it('列表写在样式里（Word 自带的「列表编号」「列表项目符号」）也认', async () => {
    const out = await read(
      docx(p('一', '<w:pStyle w:val="LN"/>') + p('二', '<w:pStyle w:val="LN"/>') + p('点', '<w:pStyle w:val="LB2"/>'), {
        'word/styles.xml': `<w:styles ${W}><w:style w:styleId="LN"><w:name w:val="List Number"/></w:style><w:style w:styleId="LB2"><w:name w:val="List Bullet 2"/></w:style></w:styles>`,
      }),
    )
    expect(out.text).toBe(['1. 一', '2. 二', '  - 点'].join('\n\n'))
  })
  it('没有文字、旧版 .doc、加密、坏的 zip、普通压缩包都给说法', async () => {
    expect(await error(docx(p('  ')))).toContain('没有能提取的文字')
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
    expect(await error(new File([ole], '旧.doc'))).toContain('另存为 .docx')
    expect(await error(new File([ole], '加密.xlsx'))).toContain('密码')
    expect(await error(new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], '坏.docx'))).toContain('损坏')
    expect(await error(zip({ 'a.txt': 'x' }, '打包.zip'))).toContain('压缩包')
    // 扩展名是 docx、内容不是 zip（被加密软件加过密）
    const scrambled = new Uint8Array(4096).map((_, i) => (i * 37 + 11) % 256)
    expect(await error(new File([scrambled], '3.docx'))).toContain('加密软件')
  })
})

describe('Excel', () => {
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  const sheet = (rows: string) => `<worksheet ${S}><sheetData>${rows}</sheetData></worksheet>`
  const workbook = (sheets: Record<string, string>) => {
    const names = Object.keys(sheets)
    return zip(
      {
        'xl/workbook.xml': `<workbook ${S} xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
        'xl/sharedStrings.xml': `<sst ${S}><si><t>名称</t></si><si><r><t>金</t></r><r><t>额</t></r></si><si><t>苹果, 红</t></si></sst>`,
        'xl/styles.xml': `<styleSheet ${S}><numFmts><numFmt numFmtId="176" formatCode="yyyy&quot;年&quot;m&quot;月&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="176"/><xf numFmtId="20"/></cellXfs></styleSheet>`,
        ...Object.fromEntries(names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheets[n]])),
      },
      '账.xlsx',
    )
  }
  it('每个表一节 CSV：共享 / 富文本 / 内联字符串、公式值、布尔、日期；空行空列去掉', async () => {
    const out = await read(
      workbook({
        一月: sheet(
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>日期</t></is></c></row>' +
            '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><f>1+2</f><v>3</v></c><c r="D3" s="1"><v>45352</v></c><c r="E3" t="b"><v>1</v></c></row>' +
            '<row r="4"><c r="A4"><v>7</v></c><c r="D4" s="2"><v>45352.5</v></c><c r="F4" s="3"><v>0.5</v></c></row>',
        ),
        空的: sheet(''),
      }),
    )
    expect(out.source).toBe('xlsx')
    expect(out.text).toBe(
      [
        '## 工作表「一月」（3 行 × 5 列）\n名称,金额,日期,,\n"苹果, 红",3,2024-03-01,TRUE,\n7,,2024-03-01 12:00,,12:00',
        '## 工作表「空的」\n（空表）',
      ].join('\n\n'),
    )
  })
  it('一个表最多带 200 行，写明一共多少行；列字母和日期序号', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join(
      '',
    )
    const out = await read(workbook({ 大表: sheet(rows) }))
    expect(out.text).toContain('（只带了前 200 行，一共 250 行）')
    expect(out.text.split('\n')).toHaveLength(1 + 200 + 1)
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('AB12')).toBe(27)
    expect(excelDate(45352)).toBe('2024-03-01')
    // 设成日期格式的长编号超出日期范围：原样写，不让整本报坏
    expect(excelDate(1234567890123)).toBe('1234567890123')
  })
  it('几十万行也不会因为展开参数报错', () => {
    const rows = Array.from({ length: 300_000 }, (_, i) => [String(i), i % 2 ? 'x' : ''])
    expect(compactRows(rows)).toHaveLength(300_000)
    expect(widest(rows)).toBe(2)
  })
})

describe('PPT', () => {
  const A = 'xmlns:a="a" xmlns:p="p" xmlns:r="r"'
  const shape = (type: string | null, paras: string[]) =>
    `<p:sp><p:nvSpPr><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.join('')}</p:txBody></p:sp>`
  const para = (text: string, lvl = 0) => `<a:p><a:pPr lvl="${lvl}"/><a:r><a:t>${text}</a:t></a:r></a:p>`
  const slide = (tree: string) => `<p:sld ${A}><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sld>`
  it('按放映顺序每页一节：标题、项目符号（缩进）、表格、组合里的形状、演讲者备注', async () => {
    const file = zip(
      {
        'ppt/presentation.xml': `<p:presentation ${A}><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
        'ppt/slides/slide2.xml': slide(
          shape('ctrTitle', [para('开场')]) +
            shape('body', [para('背景'), para('细节', 1)]) +
            `<p:grpSp>${shape(null, [para('组合里的字')])}</p:grpSp>`,
        ),
        'ppt/slides/_rels/slide2.xml.rels':
          '<Relationships><Relationship Id="rId1" Type="http://x/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
        'ppt/notesSlides/notesSlide1.xml': slide(shape('body', [para('先讲背景')])),
        'ppt/slides/slide1.xml': slide(
          shape('title', [para('数据')]) +
            `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody>${para('季度')}</a:txBody></a:tc><a:tc><a:txBody>${para('收入')}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${para('Q1')}</a:txBody></a:tc><a:tc><a:txBody>${para('10')}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
        ),
      },
      '汇报.pptx',
    )
    const out = await read(file)
    expect(out.source).toBe('pptx')
    expect(out.text).toBe(
      [
        '## 第 1 页：开场\n- 背景\n  - 细节\n- 组合里的字\n> 备注：先讲背景',
        '## 第 2 页：数据\n| 季度 | 收入 |\n| --- | --- |\n| Q1 | 10 |',
      ].join('\n\n'),
    )
  })
})

describe('提取出来的文字太长', () => {
  it('只留开头、截在换行处，写明后面省略了多少行；发给引擎时标出带了哪几行', () => {
    const line = 'x'.repeat(99) + '\n'
    const out = documentAttachment({ name: '长.docx', size: 1 }, 'docx', line.repeat(2000))
    expect(out.text.length).toBeLessThanOrEqual(FILE_INLINE_BYTES)
    expect(out.text.endsWith('\n')).toBe(true)
    expect(out.tail).toBe('')
    expect(out.lines).toBe(2000)
    expect(out.omitted).toBe(2000 - out.text.split('\n').length + 1)
    const block = fileAttachmentBlock(validateFiles([out])[0])
    expect(block).toContain(`shown="1-${2000 - out.omitted!}"`)
    expect(block).toContain(`[... ${out.omitted} more lines omitted`)
  })
})
