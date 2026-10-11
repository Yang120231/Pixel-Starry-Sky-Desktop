// 代码编辑器：把选中的代码引用到对话（docs/ui/editor-quote.md）、右键菜单
export const editorMessages = {
  'editor.quote.action': { zh: '引用到对话', en: 'Quote in chat' },
  'editor.quote.palette': { zh: '把选中的代码引用到对话', en: 'Quote selected code in chat' },
  'editor.quote.noSession': {
    zh: '没有能引用到的会话，先打开一个会话',
    en: 'No conversation to quote into. Open a conversation first.',
  },
  'editor.quote.tooLong': {
    zh: '选中的内容太长（{lines} 行、{chars} 字），最多 {maxLines} 行、{maxChars} 字。缩小范围，或让智能体直接读这个文件',
    en: 'Selection is too long ({lines} lines, {chars} characters); the limit is {maxLines} lines and {maxChars} characters. Select less, or ask the agent to read the file.',
  },
  'editor.menu.label': { zh: '编辑器菜单', en: 'Editor menu' },
  'editor.menu.cut': { zh: '剪切', en: 'Cut' },
  'editor.menu.copy': { zh: '复制', en: 'Copy' },
  'editor.menu.paste': { zh: '粘贴', en: 'Paste' },
  'editor.menu.selectAll': { zh: '全选', en: 'Select all' },
}
