import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { FILE_INLINE_BYTES } from '@pixelsky/protocol'
import { readTextFile } from '../files'
import { htmlToText } from './html'
import { ipynbText } from './ipynb'
import { rtfText } from './rtf'

const zip = (files: Record<string, string>, name: string): File =>
  new File([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))], name)
const error = async (file: File): Promise<string> => {
  try {
    await readTextFile(file)
  } catch (e) {
    return (e as Error).message
  }
  return ''
}
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"'
const odf = (type: string, body: string, name: string, manifest = '<manifest/>'): File =>
  zip(
    {
      mimetype: `application/vnd.oasis.opendocument.${type}`,
      'content.xml': `<office:document-content ${NS}><office:body>${body}</office:body></office:document-content>`,
      'META-INF/manifest.xml': manifest,
    },
    name,
  )

describe('OpenDocument', () => {
  it('文档：标题、段落（空格、制表）、套着的列表、表格、脚注；批注不要', async () => {
    const file = odf(
      'text',
      `<office:text><text:sequence-decls/>
        <text:h text:outline-level="1">季度计划</text:h>
        <text:p>收入<text:s text:c="2"/>增长<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>按人民币计</text:p></text:note-body></text:note><office:annotation><text:p>批注不要</text:p></office:annotation></text:p>
        <text:list><text:list-item><text:p>第一项</text:p><text:list><text:list-item><text:p>子项</text:p><text:list><text:list-item><text:p>孙项</text:p></text:list-item></text:list></text:list-item></text:list></text:list-item><text:list-item><text:p>第二项</text:p></text:list-item></text:list>
        <table:table><table:table-header-rows><table:table-row><table:table-cell><text:p>名称</text:p></table:table-cell><table:table-cell><text:p>数量</text:p></table:table-cell></table:table-row></table:table-header-rows>
        <table:table-row><table:table-cell><text:p>苹果</text:p></table:table-cell><table:table-cell><text:p>3</text:p></table:table-cell></table:table-row></table:table>
      </office:text>`,
      '计划.odt',
    )
    const out = await readTextFile(file)
    expect(out.source).toBe('odt')
    expect(out.text).toBe(
      [
        '# 季度计划',
        '',
        '收入  增长[^1]',
        '',
        '- 第一项\n  - 子项\n    - 孙项\n- 第二项',
        '',
        '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |',
        '',
        '[^1]: 按人民币计',
      ].join('\n'),
    )
  })

  it('表格：每个表一节 CSV；重复的行、格子展开，末尾大片空白不展开；日期用 date-value', async () => {
    const file = odf(
      'spreadsheet',
      `<office:spreadsheet><table:table table:name="销售">
        <table:table-row><table:table-cell office:value-type="string"><text:p>日期</text:p></table:table-cell><table:table-cell><text:p>金额</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16380"/></table:table-row>
        <table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="date" office:date-value="2024-03-01T00:00:00"><text:p>2024/3/1</text:p></table:table-cell><table:table-cell office:value-type="currency"><text:p>¥1,000</text:p></table:table-cell></table:table-row>
        <table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
      </table:table><table:table table:name="空"/></office:spreadsheet>`,
      '销售.ods',
    )
    const out = await readTextFile(file)
    expect(out.source).toBe('ods')
    expect(out.text).toBe(
      '## 工作表「销售」（3 行 × 2 列）\n日期,金额\n2024-03-01,"¥1,000"\n2024-03-01,"¥1,000"\n\n## 工作表「空」\n（空表）',
    )
  })

  it('演示文稿：每页一节，标题、列表、备注', async () => {
    const file = odf(
      'presentation',
      `<office:presentation><draw:page draw:name="p1">
        <draw:frame presentation:class="title"><draw:text-box><text:p>开场</text:p></draw:text-box></draw:frame>
        <draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>要点一</text:p><text:list><text:list-item><text:p>细节</text:p></text:list-item></text:list></text:list-item></text:list></draw:text-box></draw:frame>
        <presentation:notes><draw:frame presentation:class="notes"><draw:text-box><text:p>记得问好</text:p></draw:text-box></draw:frame></presentation:notes>
      </draw:page><draw:page><draw:g><draw:frame><draw:text-box><text:p>第二页的字</text:p></draw:text-box></draw:frame></draw:g></draw:page></office:presentation>`,
      '演示.odp',
    )
    const out = await readTextFile(file)
    expect(out.source).toBe('odp')
    expect(out.text).toBe('## 第 1 页：开场\n- 要点一\n  - 细节\n> 备注：记得问好\n\n## 第 2 页\n第二页的字')
  })

  it('设了密码的说读不了', async () => {
    const file = odf('text', '', '密.odt', '<manifest><file-entry><encryption-data/></file-entry></manifest>')
    expect(await error(file)).toContain('密码')
  })
})

describe('EPUB', () => {
  it('按 spine 顺序读各章，开头写书名；不在正文里的（linear="no"）不要', async () => {
    const file = zip(
      {
        mimetype: 'application/epub+zip',
        'META-INF/container.xml':
          '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        'OEBPS/content.opf': `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>小书</dc:title></metadata>
          <manifest><item id="c2" href="text/ch%202.xhtml"/><item id="c1" href="text/ch1.xhtml"/><item id="cover" href="cover.xhtml"/></manifest>
          <spine><itemref idref="cover" linear="no"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
        'OEBPS/cover.xhtml': '<html><body><p>封面</p></body></html>',
        'OEBPS/text/ch1.xhtml': '<html><head><title>x</title></head><body><h1>第一章</h1><p>开始了。</p></body></html>',
        'OEBPS/text/ch 2.xhtml': '<html><body><h1>第二章</h1><p>结束&amp;了。</p></body></html>',
      },
      '小书.epub',
    )
    const out = await readTextFile(file)
    expect(out.source).toBe('epub')
    expect(out.text).toBe('# 小书\n\n# 第一章\n\n开始了。\n\n# 第二章\n\n结束&了。')
  })
})

describe('压缩包', () => {
  it('说不能直接加，列出里面的文件（最多 50 个）', async () => {
    expect(await error(zip({ 'a.txt': 'x', 'src/b.ts': 'y' }, '打包.zip'))).toBe(
      '打包.zip 是压缩包，不能直接添加；解压后把需要的文件拖进来\n里面有 2 个文件：a.txt、src/b.ts',
    )
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}.txt`, 'x']))
    const message = await error(zip(many, '多.zip'))
    expect(message).toContain('里面有 60 个文件：f0.txt、')
    expect(message).toMatch(/f49\.txt…$/)
    expect(message).not.toContain('f50.txt')
  })
})

describe('解压后太大', () => {
  it('按包里写的原始大小算，超过 256 MB 不解，说清楚', async () => {
    // 真做一个 300 MB 的包太慢：小包里把中央目录写的原始大小改成 300 MB（解不解看的就是这个数）
    const huge = zipSync({ 'word/document.xml': strToU8('<w:document/>') })
    const view = new DataView(huge.buffer)
    const cd = huge.findIndex((_, i) => view.getUint32(i, true) === 0x02014b50)
    view.setUint32(cd + 24, 300 * 1024 * 1024, true)
    expect(await error(new File([huge], '炸弹.docx'))).toBe('炸弹.docx 解压后超过 256 MB，太大了读不了')
  })
})

describe('RTF', () => {
  it("去掉控制字和字体表、样式表、图片；段落、制表、表格；\\uN 和 GBK 的 \\'hh 都解出来", () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg936\\deff0{\\fonttbl{\\f0\\fnil\\fcharset134 \\'cb\\'ce\\'cc\\'e5;}}" +
      '{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Riched20;}{\\stylesheet{\\s0 Normal;}}' +
      "\\pard\\f0\\fs24 \\'d6\\'d0\\'ce\\'c4\\par\n" +
      'caf\\u233?\\tab x\\par\n' +
      '{\\pict\\pngblip 89504e47}' +
      '\\trowd\\cellx1000\\cellx2000 A\\cell B\\cell\\row\n' +
      '\\uc0\\u20320\\u22909 \\{ok\\}\\par}'
    expect(rtfText(new Uint8Array([...rtf].map(c => c.charCodeAt(0))))).toBe('中文\ncafé\tx\nA | B\n你好{ok}')
  })
  it("字体字符集决定 \\'hh 怎么解（\\ansicpg1252 里的中文字体）", () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}{\\f1\\fcharset134 SimSun;}}\\f0 caf\\'e9 \\f1\\'d6\\'d0}"
    expect(rtfText(new Uint8Array([...rtf].map(c => c.charCodeAt(0))))).toBe('café 中')
  })
  it('按开头的 {\\rtf 认，不看扩展名', async () => {
    const out = await readTextFile(new File(['{\\rtf1\\ansi hello\\par}'], 'note.doc'))
    expect(out).toMatchObject({ source: 'rtf', text: 'hello' })
  })
})

describe('网页', () => {
  it('去掉脚本、样式、head；标题、列表、表格、图片 alt、实体', () => {
    const html =
      '<!doctype html><html><head><title>T</title><style>p{}</style></head><body><script>var a = "<p>"</script>' +
      '<header>站点</header><h2>小标题</h2><p>一段&nbsp;<b>加粗</b> &copy; 2024 &amp; <a href="x">链接</a></p>' +
      '<ul><li>甲</li><li>乙</li></ul><table><tr><th>名</th><th>值</th></tr><tr><td>a|b</td><td><i>1</i></td></tr></table>' +
      '<img src="x.png" alt="示意图"><img src="y.png"><br>末尾</body></html>'
    expect(htmlToText(html)).toBe(
      '站点\n\n## 小标题\n\n一段 加粗 © 2024 & 链接\n\n- 甲\n- 乙\n\n| 名 | 值 |\n| --- | --- |\n| a\\|b | 1 |\n\n[示意图]\n末尾',
    )
  })
  it('小网页照原样带（源码更有用）；大到会被截断时只带正文，开头写标题', async () => {
    const small = await readTextFile(new File(['<html><body><p>hi</p></body></html>'], 'a.html'))
    expect(small.source).toBeUndefined()
    expect(small.text).toBe('<html><body><p>hi</p></body></html>')
    const big = `<html><head><title>大页面</title><script>${'x'.repeat(FILE_INLINE_BYTES)}</script></head><body><p>正文</p></body></html>`
    expect(await readTextFile(new File([big], 'b.htm'))).toMatchObject({ source: 'html', text: '# 大页面\n\n正文' })
  })
})

describe('Jupyter', () => {
  const nb = {
    metadata: { language_info: { name: 'python' } },
    cells: [
      { cell_type: 'markdown', source: ['# 分析\n', '看看数据'] },
      {
        cell_type: 'code',
        source: 'print(1)\ndf.plot()',
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['  1\n'] },
          { output_type: 'display_data', data: { 'image/png': 'iVBOR...' } },
          { output_type: 'execute_result', data: { 'text/plain': '<Axes>', 'text/html': '<div/>' } },
        ],
      },
      {
        cell_type: 'code',
        source: '1/0',
        outputs: [
          {
            output_type: 'error',
            ename: 'ZeroDivisionError',
            evalue: 'division by zero',
            traceback: ['\x1b[0;31m...'],
          },
        ],
      },
      { cell_type: 'code', source: '', outputs: [] },
    ],
  }
  it('按单元格写：Markdown 原样，代码放代码块，输出只留文字，图片写一句', () => {
    expect(ipynbText(JSON.stringify(nb))).toBe(
      [
        '# 分析\n看看数据',
        '```python\nprint(1)\ndf.plot()\n```\n输出：\n```\n  1\n\n（图片输出，没带）\n<Axes>\n```',
        '```python\n1/0\n```\n输出：\n```\nZeroDivisionError: division by zero\n```',
      ].join('\n\n'),
    )
  })
  it('太长的输出截掉；不是笔记本的 JSON 照普通文本读', async () => {
    const long = {
      cells: [{ cell_type: 'code', source: 'x', outputs: [{ output_type: 'stream', text: 'y'.repeat(5000) }] }],
    }
    expect(ipynbText(JSON.stringify(long))).toContain('…（输出太长，后面没带）')
    expect(ipynbText('{"a":1}')).toBeNull()
    const out = await readTextFile(new File([JSON.stringify(nb)], 'a.ipynb'))
    expect(out.source).toBe('ipynb')
    const plain = await readTextFile(new File(['{"a":1}'], 'b.ipynb'))
    expect(plain.source).toBeUndefined()
  })
})
