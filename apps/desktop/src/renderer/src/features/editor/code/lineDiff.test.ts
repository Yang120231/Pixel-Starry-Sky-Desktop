import { describe, expect, it } from 'vitest'
import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { lineDiff, lineDiffConfig } from './lineDiff'

/** 按改动把 a 变成 b，验证改动本身是对的 */
function apply(a: string, b: string): string {
  let out = '',
    pos = 0
  for (const c of lineDiff(a, b)) {
    out += a.slice(pos, c.fromA) + b.slice(c.fromB, c.toB)
    pos = c.toA
  }
  return out + a.slice(pos)
}

/** MergeView 实际会怎么分块：返回每块两边的行号区间（1 起），纯新增时左边为空 */
function chunks(a: string, b: string): string[] {
  const docA = Text.of(a.split('\n')),
    docB = Text.of(b.split('\n'))
  return Chunk.build(docA, docB, lineDiffConfig).map(c => {
    const side = (doc: Text, from: number, to: number) =>
      from === to ? '∅' : `${doc.lineAt(from).number}-${doc.lineAt(Math.max(from, to - 1)).number}`
    return `${side(docA, c.fromA, c.toA)} → ${side(docB, c.fromB, c.toB)}`
  })
}

const imports = [
  'package com.example;',
  '',
  'import a.b.Chest;',
  'import a.b.Item;',
  'import c.systems.RenderSystem;',
  'import c.vertex.DefaultVertexFormat;',
  'import c.vertex.PoseStack;',
  'import net.core.BlockPos;',
  'import net.core.particles.ParticleTypes;',
  'import net.sounds.SoundEvents;',
  '',
]

describe('lineDiff：按行比对', () => {
  it('一串 import 里插几行：只有新增的行是改动，后面不再整段标成改动', () => {
    const a = imports.join('\n')
    const b = [
      ...imports.slice(0, 4),
      'import c.platform.InputConstants;',
      ...imports.slice(4, 8),
      'import net.chat.Component;',
      ...imports.slice(8),
    ].join('\n')
    expect(apply(a, b)).toBe(b)
    // 两块，都是纯新增（左边空），分别是右边第 5 行、第 10 行
    expect(chunks(a, b)).toEqual(['∅ → 5-5', '∅ → 10-10'])
  })

  it('删掉几行：右边空', () => {
    const a = imports.join('\n')
    const b = [...imports.slice(0, 5), ...imports.slice(7)].join('\n')
    expect(apply(a, b)).toBe(b)
    expect(chunks(a, b)).toEqual(['6-7 → ∅'])
  })

  it('改了一行里的一小段：只标那一段（按字符细分）', () => {
    const a = imports.join('\n')
    const b = a.replace('PoseStack', 'PoseStacks')
    const changes = lineDiff(a, b)
    expect(apply(a, b)).toBe(b)
    expect(changes).toHaveLength(1)
    expect(b.slice(changes[0].fromB, changes[0].toB)).toBe('s')
  })

  it('一行改得面目全非：整行算改', () => {
    const a = 'one\ntwo\nthree\n'
    const b = 'one\nXYZW-totally-new\nthree\n'
    const changes = lineDiff(a, b)
    expect(apply(a, b)).toBe(b)
    expect(changes).toHaveLength(1)
    expect(a.slice(changes[0].fromA, changes[0].toA)).toBe('two')
  })

  it('文件末尾增删行，最后一行有没有换行符都对', () => {
    for (const [a, b] of [
      ['a\nb', 'a\nb\nc'],
      ['a\nb\nc', 'a\nb'],
      ['a\nb\n', 'a\nb\nc\n'],
      ['a\nb', 'a\nb\n'],
      ['', 'x\ny\n'],
      ['x\ny\n', ''],
      ['x', 'x'],
    ])
      expect(apply(a, b), JSON.stringify([a, b])).toBe(b)
  })

  it('Windows 换行（CRLF）也按行比对', () => {
    const a = imports.join('\r\n')
    const b = [...imports.slice(0, 4), 'import c.platform.InputConstants;', ...imports.slice(4)].join('\r\n')
    expect(apply(a, b)).toBe(b)
    expect(lineDiff(a, b)).toHaveLength(1)
  })
})
