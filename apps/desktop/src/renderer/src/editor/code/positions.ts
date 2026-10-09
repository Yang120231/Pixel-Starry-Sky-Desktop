import { tr } from '../../i18n/core'
import { Text } from '@codemirror/state'

export function linePosition(content: string, line: number, column = 1): number {
  const doc = Text.of(content.replace(/\r\n/g, '\n').split('\n'))
  const target = doc.line(Math.max(1, Math.min(Math.trunc(line) || 1, doc.lines)))
  return target.from + Math.max(0, Math.min((Math.trunc(column) || 1) - 1, target.length))
}
export function fileIndent(content: string): { unit: string; label: string } {
  const indents = content.split('\n').slice(0, 1000).map(l => /^(\s+)\S/.exec(l)?.[1]).filter((s): s is string => !!s)
  if (indents.some(i => i.includes('\t'))) return { unit: '\t', label: 'Tab' }
  const width = Math.min(...indents.map(i => i.length).filter(n => n >= 2 && n <= 8), 4)
  return { unit: ' '.repeat(width), label: tr("editor.code.positions.message415", { p0: width }) }
}
