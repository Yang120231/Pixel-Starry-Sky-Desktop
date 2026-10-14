import { describe, expect, it } from 'vitest'
import { parseClaudeLogin } from '../src/claude/login'
import { parseCodexLogin } from '../src/codex/login'

describe('parseClaudeLogin', () => {
  it('认出授权网址', () => {
    expect(
      parseClaudeLogin("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=x"),
    ).toEqual({ url: 'https://claude.com/cai/oauth/authorize?code=true&state=x' })
  })
  it('认出等授权码的提示符', () => {
    expect(parseClaudeLogin('Paste code here if prompted >')).toEqual({ awaitingCode: true })
  })
  it('无关的行什么也不认', () => {
    expect(parseClaudeLogin('Opening browser to sign in…')).toEqual({})
  })
})

describe('parseCodexLogin', () => {
  it('浏览器登录：只认 auth.openai.com，不认本地回调地址', () => {
    expect(parseCodexLogin('Starting local login server on http://localhost:1455.')).toEqual({})
    expect(parseCodexLogin('https://auth.openai.com/oauth/authorize?client_id=a&state=b')).toEqual({
      url: 'https://auth.openai.com/oauth/authorize?client_id=a&state=b',
    })
  })
  it('设备码登录：网址和一次性码，带颜色也行', () => {
    const link = parseCodexLogin(
      '1. Open this link in your browser: \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m',
    )
    expect(link.url).toContain('https://auth.openai.com/codex/device')
    expect(parseCodexLogin('2. Enter this one-time code (expires in 15 minutes) \x1b[94mWHYJ-RGMV5\x1b[0m')).toEqual({
      userCode: 'WHYJ-RGMV5',
    })
    expect(parseCodexLogin('WHYJ-RGMV5')).toEqual({ userCode: 'WHYJ-RGMV5' })
  })
})
