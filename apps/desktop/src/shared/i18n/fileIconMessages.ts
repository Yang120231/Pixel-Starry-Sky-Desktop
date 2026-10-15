// 扩展中心（fileIcon）的界面文案：文件图标主题、被忽略文件的隐藏开关
export const fileIconMessages = {
  'fileIcons.hideIgnored': { zh: '隐藏被忽略的文件', en: 'Hide ignored files' },
  'fileIcons.treeMenu': { zh: '更多', en: 'More' },
  'fileIcons.simple': { zh: '简单', en: 'Simple' },
  'fileIcons.material': { zh: 'Material（彩色）', en: 'Material (colorful)' },
  'fileIcons.description': {
    zh: '文件树、编辑器标签和搜索结果里文件和文件夹的图标。装了图标主题扩展后也会出现在这里。',
    en: 'Icons for files and folders in the file tree, editor tabs and search results. Icon theme extensions you install show up here too.',
  },
} as const satisfies Record<string, { zh: string; en: string }>
