// Jupyter 笔记本（.ipynb）→ 文字（docs/ui/composer-file-attachments.md §7.3）：按单元格写，Markdown 原样、代码放代码块；
// 输出只留文字（stream、text/plain、报错的名字和说明），图片输出写一句「图片输出，没带」，太长的输出截掉
import { tr } from '@/i18n/core'

const OUTPUT_LIMIT = 2000

interface Output {
  output_type?: string
  text?: string | string[]
  data?: Record<string, string | string[]>
  ename?: string
  evalue?: string
}
interface Cell {
  cell_type?: string
  source?: string | string[]
  outputs?: Output[]
}

const join = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join('') : (v ?? ''))
// 输出里常有终端颜色
// eslint-disable-next-line no-control-regex -- 故意匹配终端转义码（ANSI 颜色序列）
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

function outputText(o: Output): string {
  if (o.output_type === 'stream') return plain(join(o.text))
  if (o.output_type === 'error') return plain(`${o.ename ?? 'Error'}: ${o.evalue ?? ''}`)
  const data = o.data ?? {}
  if (data['text/plain'] !== undefined) return plain(join(data['text/plain']))
  return Object.keys(data).some(k => k.startsWith('image/')) ? tr('composer.extract.imageOutput') : ''
}

/** 不是笔记本（JSON 不对、没有 cells）时返回 null，按普通文本读 */
export function ipynbText(source: string): string | null {
  let nb: { cells?: Cell[]; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } }
  try {
    nb = JSON.parse(source)
  } catch {
    return null
  }
  if (!Array.isArray(nb?.cells)) return null
  const lang = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? ''
  return nb.cells
    .map(cell => {
      const src = join(cell.source).trim()
      if (cell.cell_type !== 'code') return src
      const parts = [`\`\`\`${lang}\n${src}\n\`\`\``]
      // 只去掉前后的空行，第一行行首的空格要留着（表格的对齐）
      let out = (cell.outputs ?? []).map(outputText).filter(Boolean).join('\n').replace(/^\n+/, '').trimEnd()
      if (out.length > OUTPUT_LIMIT) out = `${out.slice(0, OUTPUT_LIMIT)}\n${tr('composer.extract.outputCut')}`
      if (out) parts.push(`${tr('composer.extract.output')}：\n\`\`\`\n${out}\n\`\`\``)
      return src || out ? parts.join('\n') : ''
    })
    .filter(Boolean)
    .join('\n\n')
}
