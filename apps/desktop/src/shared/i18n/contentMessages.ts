// 内容高亮第二期的词条（docs/ui/content-highlight.md）：对话内搜索、提示块、长代码折叠
export const contentMessages = {
  'content.find.label': { zh: '在对话中查找', en: 'Find in conversation' },
  'content.find.placeholder': { zh: '查找…', en: 'Find…' },
  'content.find.count': { zh: '{current}/{total}', en: '{current}/{total}' },
  'content.find.none': { zh: '无结果', en: 'No results' },
  'content.find.previous': { zh: '上一个（Shift+Enter）', en: 'Previous (Shift+Enter)' },
  'content.find.next': { zh: '下一个（Enter）', en: 'Next (Enter)' },
  'content.find.close': { zh: '关闭（Esc）', en: 'Close (Esc)' },
  'content.find.expandFoldedOne': { zh: '展开折叠中的 1 处', en: 'Expand 1 hidden match' },
  'content.find.expandFoldedMany': { zh: '展开折叠中的 {n} 处', en: 'Expand {n} hidden matches' },
  'content.find.expandFoldedTitle': {
    zh: '这些命中在折叠起来的工具输出、思考或详情里，点击展开它们',
    en: 'These matches are in collapsed tool output, reasoning or details. Click to expand them.',
  },
  'content.alert.note': { zh: '说明', en: 'Note' },
  'content.alert.tip': { zh: '提示', en: 'Tip' },
  'content.alert.important': { zh: '重要', en: 'Important' },
  'content.alert.warning': { zh: '警告', en: 'Warning' },
  'content.alert.caution': { zh: '注意', en: 'Caution' },
  'content.code.expand': { zh: '展开全部（{n} 行）', en: 'Show all ({n} lines)' },
  'content.code.collapse': { zh: '收起', en: 'Collapse' },
} as const
