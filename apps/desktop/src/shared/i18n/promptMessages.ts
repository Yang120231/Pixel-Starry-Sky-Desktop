// 扩展包提示词的界面文案：对话输入框的「/」菜单、编辑器右键「发给 AI」
export const promptMessages = {
  'prompts.chip': { zh: '提示词', en: 'Prompt' },
  'prompts.sendToAi': { zh: '发给 AI', en: 'Send to AI' },
  'prompts.tooLong': {
    zh: '这条提示词太长了（最多 {max} 字）',
    en: 'This prompt is too long (max {max} characters)',
  },
  'prompts.loadFailed': { zh: '读取提示词失败：{error}', en: 'Could not read the prompt: {error}' },
} as const satisfies Record<string, { zh: string; en: string }>
