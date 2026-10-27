import { describe, expect, it } from 'vitest'
import {
  EMPTY_PLAN_DRAFT,
  QUOTE_MAX,
  noteCount,
  planEnterAction,
  quoteOf,
  refineMessage,
  splitPlan,
} from './planReviewModel'

const PLAN = [
  '# Preview 缩放惯性',
  '',
  '## 目标',
  '冻结 Preview **缩放协议**。',
  '',
  '## 实施步骤',
  '1. 核对 pan / zoom 事件。',
  '2. 用 `velocity *= 0.92` 衰减。',
  '',
  '### 验收',
  '```ts',
  '## 这不是标题',
  'pan += velocity',
  '```',
  '完成后接到 Preview 面板。',
].join('\n')

describe('splitPlan', () => {
  it('按一到三级标题切段，代码块里的 # 不算；第一行取正文（跳过围栏）', () => {
    const s = splitPlan(PLAN)
    expect(s.map(x => x.title)).toEqual(['Preview 缩放惯性', '目标', '实施步骤', '验收'])
    expect(s[1].first).toBe('冻结 Preview **缩放协议**。')
    expect(s[2].first).toBe('1. 核对 pan / zoom 事件。')
    expect(s[3].first).toBe('## 这不是标题')
    expect(s[3].text).toContain('pan += velocity')
    expect(s[0].first).toBe('')
  })

  it('开头没有标题的一段 title 为 null；四级标题不切；空计划没有段', () => {
    const s = splitPlan('先说明一下\n\n#### 小节\n内容\n## 步骤\n做事')
    expect(s.map(x => x.title)).toEqual([null, '步骤'])
    expect(s[0].text).toContain('#### 小节')
    expect(splitPlan('')).toEqual([])
  })

  it('长围栏要同样长的围栏才结束', () => {
    const s = splitPlan('## A\n````\n```\n## 还在代码里\n````\n## B\nx')
    expect(s.map(x => x.title)).toEqual(['A', 'B'])
  })
})

describe('refineMessage', () => {
  const sections = splitPlan(PLAN)

  it('没写意见（空白也不算）：undefined，引擎发默认的那句', () => {
    expect(refineMessage(sections, EMPTY_PLAN_DRAFT)).toBeUndefined()
    const blank = { notes: [{ id: '1', section: 1, quote: null, text: '  ' }], whole: ' \n' }
    expect(refineMessage(sections, blank)).toBeUndefined()
    expect(noteCount(blank)).toBe(0)
  })

  it('每条带段标题和引用（选中的原文，按段批注时是第一行），整体意见在最后', () => {
    const draft = {
      notes: [
        { id: 'a', section: 2, quote: 'velocity *= 0.92', text: '系数做成可调' },
        { id: 'b', section: 1, quote: null, text: ' 范围只做 Preview ' },
        { id: 'c', section: 3, quote: null, text: '' },
      ],
      whole: 'Mermaid 下一期',
    }
    expect(noteCount(draft)).toBe(3)
    expect(refineMessage(sections, draft)).toBe(
      [
        '用户希望继续完善计划，先不要开始执行。修改意见：',
        '',
        '1.【实施步骤】\n> velocity *= 0.92\n系数做成可调',
        '',
        '2.【目标】\n> 冻结 Preview **缩放协议**。\n范围只做 Preview',
        '',
        '整体意见：\nMermaid 下一期',
      ].join('\n'),
    )
  })

  it('开头没有标题、也没有正文第一行的段：标题写「开头」，不写空引用', () => {
    const s = [{ title: null, text: '', first: '' }]
    expect(refineMessage(s, { notes: [{ id: 'x', section: 0, quote: null, text: '改' }], whole: '' })).toBe(
      '用户希望继续完善计划，先不要开始执行。修改意见：\n\n1.【开头】\n改',
    )
  })
})

describe('quoteOf', () => {
  it('空白合并、过长截断', () => {
    expect(quoteOf('  打开后\n  松手 ')).toBe('打开后 松手')
    expect(quoteOf('字'.repeat(QUOTE_MAX + 5))).toBe(`${'字'.repeat(QUOTE_MAX)}…`)
  })
})

describe('planEnterAction', () => {
  it('写了意见：在哪按都是带意见继续完善，不会丢掉意见去开始执行', () => {
    expect(planEnterAction({ notes: 2, inPlanInput: false })).toBe('refine')
    expect(planEnterAction({ notes: 1, inPlanInput: true })).toBe('refine')
  })
  it('没写意见：意见框里不做事，别处开始执行', () => {
    expect(planEnterAction({ notes: 0, inPlanInput: true })).toBeNull()
    expect(planEnterAction({ notes: 0, inPlanInput: false })).toBe('start')
  })
})
