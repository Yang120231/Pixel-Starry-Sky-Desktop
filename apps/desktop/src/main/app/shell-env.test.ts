// 从程序坞 / 桌面菜单启动时补回登录 shell 的 PATH（macOS / Linux）
import { describe, expect, it } from 'vitest'
import { mergeEnv, parseEnv } from './shell-env'

describe('登录 shell 的环境', () => {
  it('只认两个标记之间 env -0 的输出（前后的欢迎语、提示符不算）', () => {
    const out = 'Welcome!\n__PIXELSKY_ENV__PATH=/opt/homebrew/bin:/usr/bin\0LANG=zh_CN.UTF-8\0A=b=c\0__PIXELSKY_ENV__% '
    expect(parseEnv(out)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', LANG: 'zh_CN.UTF-8', A: 'b=c' })
    expect(parseEnv('没有标记')).toEqual({})
  })

  it('PATH 用登录 shell 的，原来多出的目录接在后面；其余只补没有的，不相干的不带', () => {
    expect(
      mergeEnv(
        { PATH: '/usr/bin:/bin:/app/bin', LANG: 'en_US.UTF-8' },
        { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'zh_CN.UTF-8', NVM_DIR: '/u/.nvm', SSH_AUTH_SOCK: '/tmp/x' },
      ),
    ).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin:/bin:/app/bin', NVM_DIR: '/u/.nvm' })
  })
})
