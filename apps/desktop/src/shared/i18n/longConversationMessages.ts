// 长对话只显示最近几轮（docs/ui/turn-rail.md §9，D121）
export const longConversationMessages = {
  'longConversation.setting': { zh: '长对话先显示最近', en: 'Long conversations show the latest' },
  'longConversation.settingHint': {
    zh: '打开很长的对话时只显示最近的几轮，更早的在对话顶部点一下再显示；选「全部」就和以前一样一次全显示',
    en: 'Open a long conversation with only the latest turns; click at the top to load earlier ones. "All" shows everything at once',
  },
  'longConversation.n20': { zh: '20 轮', en: '20 turns' },
  'longConversation.n50': { zh: '50 轮', en: '50 turns' },
  'longConversation.all': { zh: '全部', en: 'All' },
  'longConversation.hidden': { zh: '更早的 {n} 轮已隐藏', en: '{n} earlier turns hidden' },
  'longConversation.showEarlier': { zh: '显示更早的 {n} 轮', en: 'Show {n} earlier turns' },
  'longConversation.showAll': { zh: '全部显示', en: 'Show all' },
  'turnRail.earlierMarker': { zh: '↑ {n}', en: '↑ {n}' },
  'turnRail.earlierItem': { zh: '更早的 {n} 轮（点击显示）', en: '{n} earlier turns (click to show)' },
} as const
