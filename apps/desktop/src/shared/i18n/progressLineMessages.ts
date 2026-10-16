// 进度卡片里子智能体下面那一行「正在做什么」（docs/ui/progress-card.md §9）
export const progressLineMessages = {
  'progressLine.task': { zh: '任务：{text}', en: 'Task: {text}' },
  'progressLine.done': { zh: '完成：{text}', en: 'Done: {text}' },
  'progressLine.failed': { zh: '失败：{text}', en: 'Failed: {text}' },
  'progressLine.stoppedAt': { zh: '停下时在：{text}', en: 'Stopped while: {text}' },
  'progressLine.recent': { zh: '最近：', en: 'Recent:' },
  'progressLine.justNow': { zh: '刚刚', en: 'just now' },
  'progressLine.secondsAgo': { zh: '{n} 秒前', en: '{n}s ago' },
  'progressLine.minutesAgo': { zh: '{n} 分钟前', en: '{n}m ago' },
} as const satisfies Record<string, { zh: string; en: string }>
