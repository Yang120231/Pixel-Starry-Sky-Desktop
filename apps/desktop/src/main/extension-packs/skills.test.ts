import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadPack, type LoadedPack } from './loader'
import {
  claudePluginName,
  ensureClaudeWrappers,
  gcClaudeWrappers,
  packSkillCommands,
  packSkillLaunch,
  wrapperDirName,
} from './skills'
import { cleanTemp, copyFixture, tempDir } from './testing'

afterEach(cleanTemp)

async function load(name: string, key = 'f-skill', revision = 1): Promise<LoadedPack> {
  const root = copyFixture(name, tempDir())
  return loadPack({
    key,
    root,
    source: 'folder',
    enabled: true,
    addedAt: 1,
    options: {},
    revision,
    appVersion: '0.4.1-beta',
  })
}

describe('skills', () => {
  it('claudePluginName 把 id 里的点换成横线', () => {
    expect(claudePluginName('pixelsky.with-skill')).toBe('ext-pixelsky-with-skill')
  })

  it('wrapperDirName 内容寻址：版本变了名字就变，同样输入名字不变', async () => {
    const a = await load('with-skill', 'f-a', 1)
    const b = await load('with-skill', 'f-a', 2)
    expect(wrapperDirName(a)).toMatch(/^ext-pixelsky-with-skill-[0-9a-f]{8}$/)
    expect(wrapperDirName(a)).toBe(wrapperDirName(a))
    expect(wrapperDirName(a)).not.toBe(wrapperDirName(b))
  })

  it('建 Claude 包装：plugin.json + skills/<名字>/，只复制 md 和图片，只含 claude 的技能', async () => {
    const pack = await load('with-skill')
    // 校验会拒绝技能里的脚本；这里直接塞进文件表，验证复制时再按扩展名过滤一次
    writeFileSync(join(pack.root, 'skills/hello/extra.sh'), 'echo hi')
    pack.files.set('skills/hello/extra.sh', 7)
    const runtime = tempDir()
    const wrappers = await ensureClaudeWrappers(runtime, [pack])
    const dir = wrappers.get('f-skill')!
    expect(dir).toBe(join(runtime, 'claude', wrapperDirName(pack)))
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))).toEqual({
      name: 'ext-pixelsky-with-skill',
      description: 'PixelSky extension skills',
    })
    expect(readFileSync(join(dir, 'skills', 'hello', 'SKILL.md'), 'utf8')).toContain('name: hello')
    expect(existsSync(join(dir, 'skills', 'hello', 'notes.md'))).toBe(true)
    expect(existsSync(join(dir, 'skills', 'hello', 'diagram.svg'))).toBe(true)
    expect(existsSync(join(dir, 'skills', 'hello', 'extra.sh'))).toBe(false)
    expect(existsSync(join(dir, 'skills', 'hola'))).toBe(false)
    expect(readdirSync(join(runtime, 'claude'))).toEqual([wrapperDirName(pack)])
  })

  it('已有的包装目录不动，没有临时目录残留', async () => {
    const pack = await load('with-skill')
    const runtime = tempDir()
    const first = (await ensureClaudeWrappers(runtime, [pack])).get('f-skill')!
    const marker = join(first, 'marker.txt')
    writeFileSync(marker, 'mine')
    const before = statSync(first).mtimeMs
    const again = (await ensureClaudeWrappers(runtime, [pack])).get('f-skill')!
    expect(again).toBe(first)
    expect(readFileSync(marker, 'utf8')).toBe('mine')
    expect(statSync(first).mtimeMs).toBe(before)
    expect(readdirSync(join(runtime, 'claude')).some(n => n.includes('.tmp-'))).toBe(false)
  })

  it('没有 claude 技能的扩展不建目录', async () => {
    const pack = await load('with-tasks')
    const runtime = tempDir()
    expect((await ensureClaudeWrappers(runtime, [pack])).size).toBe(0)
    expect(existsSync(join(runtime, 'claude'))).toBe(false)
  })

  it('停用的扩展没有技能', async () => {
    const pack = await load('with-skill')
    pack.info.enabled = false
    pack.info.live = false
    expect(packSkillCommands([pack])).toEqual([])
    expect(packSkillLaunch([pack], new Map(), 'claude').key).toBe('')
  })

  it('gcClaudeWrappers 清空 claude 目录，目录不存在也不报错', async () => {
    const pack = await load('with-skill')
    const runtime = tempDir()
    gcClaudeWrappers(runtime)
    await ensureClaudeWrappers(runtime, [pack])
    mkdirSync(join(runtime, 'claude', 'leftover'))
    gcClaudeWrappers(runtime)
    expect(readdirSync(join(runtime, 'claude'))).toEqual([])
  })

  it('packSkillLaunch：claude 给插件目录，codex 给技能目录，pixel 什么都没有', async () => {
    const pack = await load('with-skill')
    const wrappers = await ensureClaudeWrappers(tempDir(), [pack])
    const claude = packSkillLaunch([pack], wrappers, 'claude')
    expect(claude.pluginDirs).toEqual([wrappers.get('f-skill')])
    expect(claude.skillRoots).toEqual([])
    expect(JSON.parse(claude.key)).toEqual([['f-skill', wrapperDirName(pack)]])
    const codex = packSkillLaunch([pack], wrappers, 'codex')
    expect(codex.pluginDirs).toEqual([])
    expect(codex.skillRoots).toEqual([join(pack.root, 'skills/hello'), join(pack.root, 'skills/hola')])
    expect(JSON.parse(codex.key)).toEqual([['f-skill', 1, codex.skillRoots]])
    expect(packSkillLaunch([pack], wrappers, 'pixel')).toEqual({ key: '', pluginDirs: [], skillRoots: [] })
  })

  it('没有技能的扩展不进 key（图标包 / 主题开关不会让会话重启）', async () => {
    const icons = await load('unsafe-svg', 'f-icons')
    const wrappers = new Map<string, string>()
    expect(packSkillLaunch([icons], wrappers, 'claude')).toEqual({ key: '', pluginDirs: [], skillRoots: [] })
    expect(packSkillLaunch([icons], wrappers, 'codex')).toEqual({ key: '', pluginDirs: [], skillRoots: [] })
  })

  it('技能命令：<插件名>:<技能名>，只含 claude 能用的', async () => {
    const pack = await load('with-skill')
    expect(packSkillCommands([pack])).toEqual([
      { name: 'ext-pixelsky-with-skill:hello', description: 'Say hello', source: 'configured' },
    ])
  })
})
