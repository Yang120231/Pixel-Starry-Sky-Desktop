// 对话里的路径：单击打开、双击在文件夹中显示（docs/ui/path-click.md）
export const pathClickMessages = {
  'path.hint': { zh: '单击打开 · 双击在文件夹中显示', en: 'Click to open · double-click to show in folder' },
  'path.hintDiff': {
    zh: '单击展开对比 · 双击在文件夹中显示',
    en: 'Click to expand diff · double-click to show in folder',
  },
  'path.hintRemote': { zh: '单击打开', en: 'Click to open' },
  // 回复里的链接指向文件夹、项目外的路径（docs/ui/path-click.md）
  'path.hintFolder': {
    zh: '单击在文件树中显示 · 双击在文件夹中显示',
    en: 'Click to show in file tree · double-click to show in folder',
  },
  'path.hintFolderRemote': { zh: '单击在文件树中显示', en: 'Click to show in file tree' },
  'path.hintOutside': {
    zh: '不在项目里 · 单击在文件夹中显示',
    en: 'Outside the project · click to show in folder',
  },
  'path.revealRemote': {
    zh: '远程机器上的文件不能在本机文件夹中显示',
    en: 'Files on a remote machine cannot be shown in a local folder',
  },
  'path.revealDemo': { zh: '演示模式不能打开文件夹', en: 'Demo mode cannot open folders' },
  'path.revealFailed': { zh: '无法在文件夹中显示：{reason}', en: 'Cannot show in folder: {reason}' },
  'path.groupConversation': { zh: '对话', en: 'Conversation' },
  'path.shortcutReveal': { zh: '在文件夹中显示（路径上）', en: 'Show path in folder (on a path)' },
} as const
