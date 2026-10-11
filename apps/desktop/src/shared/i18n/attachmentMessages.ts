// 输入框里的文本文件附件（docs/ui/composer-file-attachments.md）；宿主报的错（protocol/files.ts）也在这里翻译
export const attachmentMessages = {
  'composer.file.add': { zh: '图片或文件', en: 'Image or file' },
  'composer.file.drop': { zh: '松开以添加图片或文件', en: 'Drop to add images or files' },
  'composer.file.tooLarge': {
    zh: '{p0} 太大，文件不能超过 50 MB',
    en: '{p0} is too large. Files must be 50 MB or smaller',
  },
  'composer.file.pdf': {
    zh: '{p0} 是 PDF，暂时不能直接添加；可以复制里面的文字粘贴进来',
    en: '{p0} is a PDF, which can’t be added yet. Copy its text and paste it instead',
  },
  'composer.file.binary': {
    zh: '{p0} 不是文本文件，不能直接发给智能体（支持日志、文本、代码、配置等文本文件）',
    en: '{p0} is not a text file and can’t be sent to the agent (logs, text, code and config files are supported)',
  },
  'composer.file.tooMany': { zh: '一条消息最多添加 10 个文件', en: 'You can add up to 10 files per message' },
  'composer.file.totalTooLarge': {
    zh: '文件内容合计不能超过 300 KB，请移除一些文件',
    en: 'Files can add up to 300 KB of text per message. Remove some files',
  },
  'composer.file.invalid': { zh: '文件附件格式不正确', en: 'Invalid file attachment' },
  'composer.file.saveError': {
    zh: '文件草稿保存失败，当前文件仍保留，请重试',
    en: 'Could not save the file draft. Your files are preserved; please retry',
  },
  'composer.file.restoreError': {
    zh: '文件草稿读取失败，请重新打开或添加文件',
    en: 'Could not restore file drafts. Reopen the conversation or add files again',
  },
  'composer.file.lines': { zh: '{p0} 行', en: '{p0} lines' },
  'composer.file.tokens': { zh: '约 {p0} tokens', en: '~{p0} tokens' },
  'composer.file.truncated': { zh: '已截断', en: 'Truncated' },
  'composer.file.truncatedHint': {
    zh: '文件较大，只带上开头 {p0} 行和结尾 {p1} 行，中间 {p2} 行省略',
    en: 'Large file: only the first {p0} and last {p1} lines are sent; {p2} lines in between are left out',
  },
  'composer.file.omitted': { zh: '… 中间省略 {p0} 行 …', en: '… {p0} lines left out …' },
  'composer.file.secret': { zh: '可能含密钥', en: 'May contain secrets' },
  'composer.file.secretHint': {
    zh: '文件名看起来像放密钥的，发送前请确认里面没有不该发出去的内容',
    en: 'This file name looks like it holds secrets. Make sure nothing in it should stay private before sending',
  },
  'composer.file.preview': { zh: '预览文件', en: 'Preview file' },
  'composer.file.previewHint': { zh: '发给智能体的内容', en: 'What the agent receives' },
  'composer.file.remove': { zh: '移除文件', en: 'Remove file' },
  'composer.file.closePreview': { zh: '关闭预览', en: 'Close preview' },
  'composer.file.encoding': { zh: '编码 {p0}', en: 'Encoding {p0}' },
  // 拖进来的文件夹（GitHub #15）
  'composer.folder.remote': {
    zh: '这个会话在远程机器上，看不到本机的文件夹；可以用 @ 引用远程机器上的文件',
    en: 'This conversation runs on a remote machine and can’t see folders on this computer. Use @ to reference files on the remote machine',
  },
  'composer.folder.noPath': {
    zh: '拿不到这个文件夹在磁盘上的路径，请从资源管理器拖进来，或用 @ 引用',
    en: 'Couldn’t get this folder’s path on disk. Drag it from File Explorer, or reference it with @',
  },
} as const
