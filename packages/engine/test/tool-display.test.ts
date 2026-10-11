// 工具行的展示数据（docs/ui/conversation-review-2026-10-11.md B7/B8/B11/B12）
import { describe, expect, it } from 'vitest'
import { completeToolItem, toolItem } from '../src/claude/tools'
import { codexChanges } from '../src/codex/translate'
import { MAX_OUTPUT, clip } from '../src/output'

describe('工具行的展示数据', () => {
  it('命令：失败时从「Exit code N」取退出码，成功是 0，中断保留原来的', () => {
    const cmd = toolItem('c', 'Bash', { command: 'false' }, 'D:/w')
    expect(completeToolItem(cmd, 'Exit code 127\nnot found', true, null)).toMatchObject({
      exitCode: 127,
      status: 'failed',
    })
    expect(completeToolItem(cmd, 'ok', false, { stdout: 'ok' })).toMatchObject({ exitCode: 0, status: 'completed' })
    expect(completeToolItem(cmd, '', false, null, 'interrupted')).toMatchObject({ exitCode: null })
  })

  it('提交计划：计划正文留在行里，批准的回话不覆盖', () => {
    const plan = toolItem('p', 'ExitPlanMode', { plan: '## 计划\n1. 改' }, 'D:/w')
    expect(plan).toMatchObject({ output: '## 计划\n1. 改' })
    expect(completeToolItem(plan, 'User has approved your plan.', false, null)).toMatchObject({
      output: '## 计划\n1. 改',
    })
  })

  it('工具结果里的图片带上（有上限），文字里仍有「[图片]」', () => {
    const read = toolItem('r', 'Read', { file_path: 'D:/w/a.png' }, 'D:/w')
    const done = completeToolItem(
      read,
      [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }],
      false,
      null,
    )
    expect(done).toMatchObject({ output: '[图片]', images: [{ mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }] })
    const huge = 'A'.repeat(3_000_001)
    const big = completeToolItem(
      read,
      [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: huge } }],
      false,
      null,
    )
    expect(big).not.toHaveProperty('images')
  })

  it('输出上限保留头尾；Codex 新建文件给原文时换成 + 的 diff', () => {
    const long = 'x'.repeat(MAX_OUTPUT * 2)
    expect(clip(long).length).toBeLessThan(long.length)
    expect(codexChanges([{ path: 'a.txt', kind: { type: 'add' }, diff: 'one\ntwo' }])[0]).toMatchObject({
      diff: '+one\n+two',
      added: 2,
    })
    expect(codexChanges([{ path: 'b.txt', kind: 'update', diff: '@@ -1 +1 @@\n-a\n+b' }])[0]).toMatchObject({
      added: 1,
      removed: 1,
    })
  })
})
