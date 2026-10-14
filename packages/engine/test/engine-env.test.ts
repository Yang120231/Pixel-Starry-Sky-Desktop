// 启动引擎时的环境变量（审查报告 2026-10-14：CLAUDE_CODE_* 原来整类丢掉，用户的配置类变量也没了）
import { describe, expect, it } from 'vitest'
import { engineEnv } from '../src/env'

describe('engineEnv', () => {
  it('丢掉「自己是别的 Claude Code 子会话」的标记和其他程序自己的变量', () => {
    const env = engineEnv({
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 's',
      CLAUDE_CODE_EXECPATH: 'x',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_MESSAGING_SOCKET: 'sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 't',
      CLAUDE_CODE_SESSION_ATTENDED: '1',
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true',
      CLAUDE_PID: '1',
      CLAUDE_EFFORT: 'high',
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50',
      MIRASIM_X: '1',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: 'x',
      PATH: 'p',
    })
    expect(env).toEqual({ PATH: 'p' })
  })
  it('保留用户的配置类 CLAUDE_CODE_*（git-bash 位置、token 登录、Bedrock / Vertex 等）', () => {
    const keep = {
      CLAUDE_CODE_GIT_BASH_PATH: 'C:/Git/bin/bash.exe',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
      CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: '1',
      ANTHROPIC_API_KEY: 'k',
    }
    expect(engineEnv(keep)).toEqual(keep)
  })
})
