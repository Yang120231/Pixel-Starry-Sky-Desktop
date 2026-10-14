// 普通输入框的系统右键菜单：只在可编辑的地方弹，按界面语言写文字，能不能点跟着浏览器给的 editFlags
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn() } }))
vi.mock('./ui-language', () => ({ windowLocale: () => 'zh-CN' }))

const { editMenuTemplate } = await import('./editMenu')

const flags = {
  canUndo: false,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
  canDelete: true,
  canEditRichly: false,
}

describe('输入框右键菜单', () => {
  it('不可编辑的地方不弹', () => {
    expect(editMenuTemplate({ isEditable: false, editFlags: flags }, 'zh-CN')).toBeNull()
  })
  it('中文：撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选，按 editFlags 置灰', () => {
    const items = editMenuTemplate({ isEditable: true, editFlags: flags }, 'zh-CN')!
    expect(items.filter(i => i.role).map(i => [i.role, i.label, i.enabled])).toEqual([
      ['undo', '撤销', false],
      ['redo', '重做', false],
      ['cut', '剪切', true],
      ['copy', '复制', true],
      ['paste', '粘贴', true],
      ['selectAll', '全选', true],
    ])
  })
  it('英文界面用英文', () => {
    const items = editMenuTemplate({ isEditable: true, editFlags: { ...flags, canCut: false } }, 'en-US')!
    expect(items.find(i => i.role === 'cut')).toMatchObject({ label: 'Cut', enabled: false })
    expect(items.find(i => i.role === 'paste')?.label).toBe('Paste')
  })
})
