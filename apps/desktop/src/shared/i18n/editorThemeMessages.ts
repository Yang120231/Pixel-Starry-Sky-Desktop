// 扩展中心（editorTheme）的界面文案：设置 › 外观里的代码配色
export const editorThemeMessages = {
  'editorTheme.description': {
    zh: '换编辑器和对比视图里的代码配色，不影响软件其他界面。深色、浅色各选一个，跟着软件的深浅色切换。',
    en: 'Change the code colors in the editor and diff views. The rest of the app is not affected. Pick one for dark and one for light; the app switches between them.',
  },
  'editorTheme.followPalette': { zh: '跟随配色', en: 'Follow palette' },
  'editorTheme.whenDark': { zh: '深色时', en: 'When dark' },
  'editorTheme.whenLight': { zh: '浅色时', en: 'When light' },
} as const satisfies Record<string, { zh: string; en: string }>
