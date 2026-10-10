// 提问卡片的推荐项（docs/ui/rewind-fork-sidechat.md §5）：选项标签里带「（推荐）」「(推荐)」「(Recommended)」
import type { Question } from '@pixelsky/protocol'

const MARK = /\s*[（(]\s*(?:推荐|recommended)\s*[)）]\s*/i

export function isRecommended(label: string): boolean {
  return MARK.test(label)
}

/** 显示用：去掉推荐记号（另外画一个「推荐」标签）；提交时仍用原文 */
export function displayLabel(label: string): string {
  return label.replace(MARK, ' ').trim() || label
}

/** 每个问题都有推荐项时，返回按推荐作答的答案；否则 null */
export function recommendedAnswers(questions: Question[]): Record<string, string> | null {
  if (questions.length === 0) return null
  const answers: Record<string, string> = {}
  for (const q of questions) {
    const picks = q.options.filter(o => isRecommended(o.label)).map(o => o.label)
    if (picks.length === 0) return null
    answers[q.question] = (q.multiSelect ? picks : picks.slice(0, 1)).join(', ')
  }
  return answers
}
