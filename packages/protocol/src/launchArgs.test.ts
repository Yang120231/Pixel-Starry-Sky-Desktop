import { describe, expect, it } from 'vitest'
import { joinArgs, splitArgs } from './launchArgs'

describe('启动参数拆分', () => {
  it('空白分隔，多个空白算一个', () => {
    expect(splitArgs('  --debug   --add-dir  src \t lib\n')).toEqual(['--debug', '--add-dir', 'src', 'lib'])
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('   ')).toEqual([])
  })

  it('引号包起来的算一个参数，相邻的引号段连成一个', () => {
    expect(splitArgs('--append-system-prompt "回答 简短一点"')).toEqual(['--append-system-prompt', '回答 简短一点'])
    expect(splitArgs(`-c 'model="gpt-5"'`)).toEqual(['-c', 'model="gpt-5"'])
    expect(splitArgs(`--x=a" b "c`)).toEqual(['--x=a b c'])
    expect(splitArgs(`a'"'"'"b`)).toEqual([`a"'b`])
  })

  it('空引号是一个空参数', () => {
    expect(splitArgs('--name "" --x')).toEqual(['--name', '', '--x'])
  })

  it('Windows 路径里的反斜杠原样保留', () => {
    expect(splitArgs('--add-dir C:\\Users\\me\\proj "D:\\My Work\\a"')).toEqual([
      '--add-dir',
      'C:\\Users\\me\\proj',
      'D:\\My Work\\a',
    ])
  })

  it('引号没配对返回 null', () => {
    expect(splitArgs('--x "abc')).toBeNull()
    expect(splitArgs("--x 'abc")).toBeNull()
  })
})

describe('启动参数拼回', () => {
  it('普通参数原样，带空白或引号的加引号，空参数写成 ""', () => {
    expect(joinArgs(['--debug', '--add-dir', 'D:\\My Work', ''])).toBe('--debug --add-dir "D:\\My Work" ""')
    expect(joinArgs(['model="gpt-5"'])).toBe(`'model="gpt-5"'`)
  })

  it('拼回的文字能原样拆回', () => {
    const cases: string[][] = [
      [],
      ['--debug'],
      ['--append-system-prompt', '回答 简短一点'],
      ['a"b', "c'd", `e"f'g`, '', ' ', 'C:\\x y\\z'],
      [`"'"`, `''`, `""`],
    ]
    for (const args of cases) expect(splitArgs(joinArgs(args))).toEqual(args)
  })
})
