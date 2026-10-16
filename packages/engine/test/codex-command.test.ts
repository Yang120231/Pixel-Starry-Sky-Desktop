import { describe, expect, it } from 'vitest'
import { codexCommand, shellWords } from '../src/codex/command'

describe('Codex 命令：去掉外面那层 shell', () => {
  it('Windows PowerShell：双引号里的 \\\\ 还原成一个反斜杠，只留 -Command 后面的脚本', () => {
    expect(
      codexCommand(
        `"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "rg -n 'Core' src"`,
      ),
    ).toBe("rg -n 'Core' src")
    expect(codexCommand(`"C:\\\\WINDOWS\\\\powershell.exe" -Command '.\\gradlew.bat test'`)).toBe('.\\gradlew.bat test')
    expect(codexCommand(`pwsh.exe -NoProfile -Command '$x=Get-Content a.txt; "$x"'`)).toBe('$x=Get-Content a.txt; "$x"')
  })

  it('bash -lc / sh -c / cmd /c 都能拆；多行脚本原样保留', () => {
    expect(codexCommand(`/bin/bash -lc 'git status --short'`)).toBe('git status --short')
    expect(codexCommand(`bash -lc "echo \\"hi\\" && ls"`)).toBe('echo "hi" && ls')
    expect(codexCommand(`/bin/zsh -l -c 'cat <<EOF\na\nEOF'`)).toBe('cat <<EOF\na\nEOF')
    expect(codexCommand(`cmd.exe /d /c dir /b`)).toBe('dir /b')
    // shlex 拼单引号：'it'"'"'s'
    expect(codexCommand(`bash -lc 'echo '"'"'it'"'"''`)).toBe("echo 'it'")
  })

  it('认不出来的原样返回：不是 shell、没有 -c、引号没闭合', () => {
    for (const line of ['ls -la', 'npm test', 'bash script.sh', 'powershell.exe -File a.ps1', `bash -lc 'oops`, ''])
      expect(codexCommand(line)).toBe(line)
  })

  it('shellWords 按 POSIX 引号规则拆词', () => {
    expect(shellWords(`a 'b c' "d\\"e" f\\ g ''`)).toEqual(['a', 'b c', 'd"e', 'f g', ''])
    expect(shellWords(`"a\\nb"`)).toEqual(['a\\nb'])
    expect(shellWords(`"open`)).toBeNull()
  })
})
