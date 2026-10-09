import { describe, expect, it } from 'vitest'
import { EDITORS, editorArgs, uninstallLocations } from './editors'

describe('Trae 检测与启动', () => {
  it('两种 Trae 都是内置 VS Code 兼容编辑器', () => {
    expect(EDITORS.find(e => e.id === 'trae-cn')).toMatchObject({ exe: 'Trae CN.exe', command: 'trae-cn' })
    expect(EDITORS.find(e => e.id === 'trae')).toMatchObject({ exe: 'Trae.exe', command: 'trae' })
  })
  it('读取卸载路径与带引号图标路径，不把国际版与 CN 混在一起', () => {
    const output = 'HKEY_CURRENT_USER\\Uninstall\\cn\n    DisplayName    REG_SZ    TraeCode CN (User)\n    InstallLocation    REG_SZ    D:\\Users\\用户\\Trae CN\n    DisplayIcon    REG_SZ    "D:\\Users\\用户\\Trae CN\\Trae CN.exe",0\nHKEY_LOCAL_MACHINE\\Uninstall\\global\n    DisplayName    REG_SZ    Trae (User)\n    InstallLocation    REG_SZ    D:\\Trae\n'
    const cn = uninstallLocations(output, EDITORS.find(e => e.id === 'trae-cn')!)
    expect(cn).toContain('D:\\Users\\用户\\Trae CN\\Trae CN.exe')
    expect(cn.some(p => p.endsWith('Trae.exe'))).toBe(false)
    expect(uninstallLocations(output, EDITORS.find(e => e.id === 'trae')!)).toEqual(['D:\\Trae\\Trae.exe'])
    expect(uninstallLocations('invalid REG_SZ whatever', EDITORS[0])).toEqual([])
  })
  it('复用 / 新窗口及行列参数原样保留中文、空格和括号', () => {
    expect(editorArgs('code', 'reuse', 'D:\\项目 (1)', 'D:\\项目 (1)\\main.ts', 12, 3)).toEqual(['--reuse-window', 'D:\\项目 (1)', '--goto', 'D:\\项目 (1)\\main.ts:12:3'])
    expect(editorArgs('code', 'new', 'D:\\项目 (1)')).toEqual(['--new-window', 'D:\\项目 (1)'])
  })
})
