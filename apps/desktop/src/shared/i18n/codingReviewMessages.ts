export const codingReviewMessages = {
  'coding.review.title': { zh: '审查', en: 'Review' },
  'coding.review.keep': { zh: '保留', en: 'Keep' },
  'coding.review.keepTitle': { zh: '标记为已审查，保留这一处改动', en: 'Mark as reviewed and keep this change' },
  'coding.review.undo': { zh: '撤销', en: 'Undo' },
  'coding.review.undoTitle': {
    zh: '把这一处换回 AI 改之前的样子（不会自动保存，Ctrl+S 保存）',
    en: 'Put this block back to how it was before the AI changed it (not saved automatically, press Ctrl+S)',
  },
  'coding.review.undoRunning': {
    zh: 'AI 还在改，等这一轮结束',
    en: 'The AI is still editing. Wait for this turn to finish',
  },
  'coding.review.ask': { zh: '问 AI', en: 'Ask AI' },
  'coding.review.askTitle': { zh: '把这一处引用到对话输入框', en: 'Quote this block into the conversation input' },
  'coding.review.deletedBlock': { zh: 'AI 删掉的内容', en: 'Removed by the AI' },
  'coding.review.bar.count': { zh: 'AI 改了这个文件 {n} 处', en: 'The AI changed {n} place(s) in this file' },
  'coding.review.bar.position': { zh: '{i} / {n}', en: '{i} / {n}' },
  'coding.review.bar.prev': { zh: '上一处', en: 'Previous change' },
  'coding.review.bar.next': { zh: '下一处', en: 'Next change' },
  'coding.review.bar.undoAll': { zh: '全部撤销', en: 'Undo all' },
  'coding.review.bar.keepAll': { zh: '全部保留', en: 'Keep all' },
  'coding.review.bar.undone': {
    zh: '已撤销 {n} 处，未保存（Ctrl+S）',
    en: 'Undid {n} place(s), not saved (Ctrl+S)',
  },
  'coding.review.bar.noBaseline': {
    zh: '没法逐块审查，已改为对比 HEAD',
    en: 'Cannot review block by block, comparing with HEAD instead',
  },
  'coding.review.bar.tooBig': {
    zh: '改动或文件太大，没法逐块审查，已改为对比 HEAD',
    en: 'Too many changes or the file is too large to review block by block, comparing with HEAD instead',
  },
}
