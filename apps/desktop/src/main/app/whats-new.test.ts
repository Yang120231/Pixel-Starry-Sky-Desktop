// 更新后的「更新内容」弹窗：什么时候弹（GitHub #13）
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WhatsNewStore } from './whats-new'

const dirs: string[] = []
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'whats-new-'))
  dirs.push(dir)
  return dir
}
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })))

describe('更新内容弹窗', () => {
  it('第一次安装不弹，记下当前版本；之后升级弹一次，带上次的版本', () => {
    const dir = fresh()
    expect(new WhatsNewStore(dir, '0.2.2-beta').pending).toBeNull()
    expect(new WhatsNewStore(dir, '0.2.2-beta').pending).toBeNull()
    const upgraded = new WhatsNewStore(dir, '0.2.3-beta')
    expect(upgraded.pending).toEqual({ version: '0.2.3-beta', previous: '0.2.2-beta' })
    // 没关弹窗就退出：下次还弹
    expect(new WhatsNewStore(dir, '0.2.3-beta').pending).not.toBeNull()
    upgraded.done()
    expect(new WhatsNewStore(dir, '0.2.3-beta').pending).toBeNull()
  })

  it('从还没有这个功能的旧版本升上来（数据目录里已有引擎数据）：弹，但不知道上次的版本', () => {
    const dir = fresh()
    mkdirSync(join(dir, 'engine'))
    expect(new WhatsNewStore(dir, '0.2.2-beta').pending).toEqual({ version: '0.2.2-beta', previous: null })
  })

  it('不再提示：以后升级都不弹，打开开关后恢复', () => {
    const dir = fresh()
    new WhatsNewStore(dir, '0.2.2-beta')
    const s = new WhatsNewStore(dir, '0.2.3-beta')
    s.setMuted(true)
    s.done()
    expect(new WhatsNewStore(dir, '0.2.4-beta').pending).toBeNull()
    expect(new WhatsNewStore(dir, '0.2.4-beta').muted).toBe(true)
    new WhatsNewStore(dir, '0.2.4-beta').setMuted(false)
    expect(new WhatsNewStore(dir, '0.2.4-beta').pending).toEqual({ version: '0.2.4-beta', previous: '0.2.3-beta' })
  })

  it('状态文件坏了按没有处理', () => {
    const dir = fresh()
    writeFileSync(join(dir, 'whats-new.json'), '{oops')
    expect(new WhatsNewStore(dir, '0.2.2-beta').pending).toBeNull()
    expect(JSON.parse(readFileSync(join(dir, 'whats-new.json'), 'utf8'))).toEqual({ seen: '0.2.2-beta', muted: false })
  })
})
