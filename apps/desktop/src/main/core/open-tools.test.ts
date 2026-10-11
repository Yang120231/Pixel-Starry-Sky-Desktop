// 「打开方式」里的 JetBrains IDE 和文件夹 / 终端程序（GitHub #12）
import { describe, expect, it } from 'vitest'
import { editorArgs } from './editors'
import { jetbrainsFromUninstall, jetbrainsName, toolCommand } from './open-tools'

const uninstall = String.raw`
HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\IntelliJ IDEA 2026.2.1
    DisplayName    REG_SZ    IntelliJ IDEA 2026.2.1
    InstallLocation    REG_SZ    D:\Program Files\JetBrains\IntelliJ IDEA 2026.2.1
    DisplayIcon    REG_SZ    D:\Program Files\JetBrains\IntelliJ IDEA 2026.2.1\bin\idea64.exe
    Publisher    REG_SZ    JetBrains s.r.o.

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\PyCharm Community Edition 2025.3
    DisplayName    REG_SZ    PyCharm Community Edition 2025.3
    InstallLocation    REG_SZ    "C:\Program Files\JetBrains\PyCharm Community Edition 2025.3"
    Publisher    REG_SZ    JetBrains s.r.o.

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\Fake
    DisplayName    REG_SZ    IntelliJ IDEA helper
    Publisher    REG_SZ    Someone else
`

describe('JetBrains IDE', () => {
  it('从卸载信息里认出来：DisplayIcon 指着 exe 时用它，不然用 InstallLocation\\bin；别家的同名程序不算', () => {
    expect(jetbrainsFromUninstall(uninstall)).toEqual([
      {
        path: 'D:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.2.1\\bin\\idea64.exe',
        name: 'IntelliJ IDEA 2026.2.1',
      },
      {
        path: 'C:\\Program Files\\JetBrains\\PyCharm Community Edition 2025.3\\bin\\pycharm64.exe',
        name: 'PyCharm Community Edition 2025.3',
      },
    ])
  })

  it('名字是产品名，版本从显示名或安装目录名里取', () => {
    expect(jetbrainsName('D:\\JB\\IntelliJ IDEA 2026.2.1\\bin\\idea64.exe')).toEqual({
      name: 'IntelliJ IDEA',
      version: '2026.2.1',
    })
    expect(jetbrainsName('C:\\x\\bin\\pycharm64.exe', 'PyCharm Community Edition 2025.3')).toEqual({
      name: 'PyCharm',
      version: '2025.3',
    })
    expect(jetbrainsName('C:\\Users\\me\\AppData\\Local\\Programs\\WebStorm\\bin\\webstorm64.exe')).toEqual({
      name: 'WebStorm',
      version: undefined,
    })
  })

  it('打开参数：工作区；文件带 --line / --column，项目目录在前', () => {
    expect(editorArgs('jetbrains', 'reuse', 'D:\\proj')).toEqual(['D:\\proj'])
    expect(editorArgs('jetbrains', 'reuse', 'D:\\proj', 'D:\\proj\\a.ts', 12, 3)).toEqual([
      'D:\\proj',
      '--line',
      '12',
      '--column',
      '3',
      'D:\\proj\\a.ts',
    ])
    expect(editorArgs('jetbrains', 'new', 'D:\\proj', 'D:\\proj\\a.ts')).toEqual(['D:\\proj', 'D:\\proj\\a.ts'])
    expect(() => editorArgs('jetbrains', 'reuse', 'D:\\proj', 'D:\\proj\\a.ts', 0)).toThrow('行列')
  })
})

describe('文件夹和终端', () => {
  const tool = (id: 'git-bash' | 'windows-terminal' | 'pwsh' | 'powershell', path = `C:\\${id}.exe`) => ({
    id,
    name: id,
    path,
  })
  it('各自按自己的参数停在工作区目录', () => {
    expect(toolCommand(tool('git-bash'), 'D:\\my proj')).toEqual({
      file: 'C:\\git-bash.exe',
      args: ['--cd=D:\\my proj'],
      console: false,
    })
    expect(toolCommand(tool('windows-terminal'), 'D:\\p').args).toEqual(['-d', 'D:\\p'])
    expect(toolCommand(tool('pwsh'), 'D:\\p')).toMatchObject({
      args: ['-NoExit', '-WorkingDirectory', 'D:\\p'],
      console: true,
    })
    expect(toolCommand(tool('powershell'), 'D:\\p')).toMatchObject({ args: ['-NoExit'], console: true })
  })
})
