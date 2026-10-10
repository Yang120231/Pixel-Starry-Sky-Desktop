import { describe, expect, it } from 'vitest'
import { displayLabel, isRecommended, recommendedAnswers } from './questionModel'

const q = (question: string, labels: string[], multiSelect = false) => ({
  question,
  header: '',
  multiSelect,
  options: labels.map(label => ({ label, description: '' })),
})

describe('提问卡片的推荐项', () => {
  it('认中英文和全角半角括号，显示时去掉记号', () => {
    expect(isRecommended('7 天（推荐）')).toBe(true)
    expect(isRecommended('Keep it (Recommended)')).toBe(true)
    expect(isRecommended('30 天')).toBe(false)
    expect(displayLabel('7 天（推荐）')).toBe('7 天')
    expect(displayLabel('Keep it (Recommended)')).toBe('Keep it')
  })

  it('每题都有推荐才给答案；多选题选全部推荐项，单选只取第一个', () => {
    expect(
      recommendedAnswers([
        q('多久', ['7 天（推荐）', '30 天']),
        q('提示', ['一行字 (推荐)', '小圆点（推荐）', '不提示'], true),
      ]),
    ).toEqual({ 多久: '7 天（推荐）', 提示: '一行字 (推荐), 小圆点（推荐）' })
    expect(recommendedAnswers([q('多久', ['7 天（推荐）']), q('提示', ['一行字', '小圆点'])])).toBeNull()
    expect(recommendedAnswers([])).toBeNull()
  })
})
