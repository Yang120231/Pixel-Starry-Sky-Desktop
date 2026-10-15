// 扩展中心（extTask）的界面文案：任务模板（左栏「任务」里扩展提供的分组）
export const extTaskMessages = {
  'tasks.ext.hint': { zh: '来自扩展 {name}', en: 'From extension {name}' },
  'tasks.ext.truncated': {
    zh: '部分任务没有读全（文件或模板太多，或某个提取规则超时）',
    en: 'Some tasks were not fully read (too many files or templates, or an extract rule timed out)',
  },
} as const satisfies Record<string, { zh: string; en: string }>
