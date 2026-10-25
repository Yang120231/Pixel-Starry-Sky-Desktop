import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  effective,
  expandedMcp,
  inside,
  mcpConfig,
  pluginDirectory,
  pluginHooks,
  skillFile,
} from '../src/extensions/parse'
import type { ExtensionEntry } from '@pixelsky/protocol'
import { makeTmp, removeTmp } from './helpers/tmp'
let root: string
beforeEach(() => {
  root = makeTmp('extension-parser')
})
afterEach(() => removeTmp(root))
describe('扩展解析与范围', () => {
  it('MCP 环境引用按会话环境解析，缺失值显式报错', () => {
    expect(
      expandedMcp(
        { type: 'http', url: '${BASE}/mcp', headers: { Authorization: 'Bearer ${TOKEN:-local}' } },
        { BASE: 'https://example.com' },
      ),
    ).toMatchObject({ url: 'https://example.com/mcp', headers: { Authorization: 'Bearer local' } })
    expect(() => expandedMcp({ type: 'stdio', command: '${MISSING}' }, {})).toThrow('MISSING')
  })
  it('项目停用覆盖全局启用，不影响其他项目', () => {
    const base: ExtensionEntry = {
      id: 'a',
      kind: 'mcp',
      name: 'tools',
      description: '',
      scope: { kind: 'global' },
      enabled: true,
      origin: 'managed',
      source: { kind: 'created', location: '' },
      components: [],
    }
    const local = { ...base, id: 'b', scope: { kind: 'project' as const, path: root }, enabled: false }
    expect(effective([local, base], root)).toEqual([])
    expect(effective([base, local], root + '-other')).toEqual([base])
  })
  it('拒绝越界、错误传输和无类型 URL；兼容 streamable-http', () => {
    expect(() => inside(root, join(root, '../outside'))).toThrow('超出')
    expect(() => mcpConfig({ url: 'https://example.com' })).toThrow('命令')
    expect(() => mcpConfig({ type: 'sdk' })).toThrow('支持')
    expect(mcpConfig({ type: 'streamable-http', url: 'https://example.com/mcp' })).toMatchObject({ type: 'http' })
    expect(() => mcpConfig({ type: 'http', url: 'https://user:pass@example.com' })).toThrow('凭据')
  })
  it('读取 YAML 与支持文件，避免把插件停用条件当成可调用技能', () => {
    const dir = join(root, 'skills/run')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: run\ndescription: |\n  执行项目测试\nuser-invocable: false\n---\n# 步骤\n',
    )
    mkdirSync(join(root, '.claude-plugin'))
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tools', version: '1.0' }))
    const p = pluginDirectory(root)
    expect(p.components).toHaveLength(1)
    expect(p.components[0]).toMatchObject({ name: 'run', invocable: false })
    expect(skillFile(join(dir, 'SKILL.md')).description).toContain('执行')
  })
  it('拒绝插件 manifest 的包外组件路径', () => {
    mkdirSync(join(root, '.claude-plugin'))
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tools', skills: '../outside' }))
    expect(() => pluginDirectory(root)).toThrow('超出')
  })
  it('插件目录先整体校验再读 manifest：层级过深先报错，组件只遍历一次也不丢', () => {
    const deep = join(root, 'deep'),
      nested = join(deep, ...Array.from({ length: 18 }, (_, i) => 'd' + i))
    mkdirSync(nested, { recursive: true })
    // 没有 plugin.json：若先读 manifest 会报找不到文件，这里要先报目录问题
    expect(() => pluginDirectory(deep)).toThrow('层级过深')
    const ok = join(root, 'ok')
    mkdirSync(join(ok, '.claude-plugin'), { recursive: true })
    mkdirSync(join(ok, 'skills/a'), { recursive: true })
    mkdirSync(join(ok, 'commands'), { recursive: true })
    writeFileSync(join(ok, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'pack', skills: 'extra' }))
    writeFileSync(join(ok, 'skills/a/SKILL.md'), '---\nname: a\n---\nx')
    writeFileSync(join(ok, 'commands/c.md'), '---\nname: c\n---\nx')
    mkdirSync(join(ok, 'extra/b'), { recursive: true })
    writeFileSync(join(ok, 'extra/b/SKILL.md'), '---\nname: b\n---\nx')
    expect(
      pluginDirectory(ok)
        .components.map(c => c.name)
        .sort(),
    ).toEqual(['a', 'b', 'c'])
  })
  it('plugin.json 里内联写的 mcpServers 对象也读出 MCP；数组形式照旧读文件', () => {
    mkdirSync(join(root, '.claude-plugin'))
    writeFileSync(
      join(root, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'tools', mcpServers: { inline: { command: 'node', args: ['s.js'] } } }),
    )
    expect(pluginDirectory(root).components).toMatchObject([{ kind: 'mcp', name: 'inline' }])
    writeFileSync(join(root, 'a.json'), JSON.stringify({ mcpServers: { fromFile: { command: 'node' } } }))
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tools', mcpServers: ['a.json'] }))
    expect(pluginDirectory(root).components).toMatchObject([{ kind: 'mcp', name: 'fromFile' }])
  })
})

describe('插件自带钩子', () => {
  const manifest = (hooks?: unknown): void => {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true })
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'hooky', hooks }))
  }
  const cmd = (command: string): unknown => ({ type: 'command', command, timeout: 15 })
  it('读 manifest 指向的文件和默认 hooks/hooks.json，同一文件不重复，坏文件与包外路径只跳过', () => {
    manifest(['./hooks/a.json', './hooks/a.json', './hooks/bad.json', './hooks/missing.json', { Stop: [] }])
    mkdirSync(join(root, 'hooks'))
    writeFileSync(
      join(root, 'hooks/a.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{ matcher: 'startup|resume', hooks: [cmd('node a.js')] }],
          UserPromptSubmit: [{ hooks: [cmd('node b.js'), { type: 'http', url: 'https://example.com/h' }, {}] }],
        },
      }),
    )
    writeFileSync(join(root, 'hooks/bad.json'), '{')
    writeFileSync(
      join(root, 'hooks/hooks.json'),
      JSON.stringify({ PreToolUse: [{ matcher: 'Bash', hooks: [cmd('c')] }] }),
    )
    expect(pluginHooks(root)).toEqual([
      { event: 'SessionStart', matcher: 'startup|resume', type: 'command', command: 'node a.js', timeout: 15 },
      { event: 'UserPromptSubmit', matcher: '', type: 'command', command: 'node b.js', timeout: 15 },
      { event: 'UserPromptSubmit', matcher: '', type: 'http', command: 'https://example.com/h' },
      { event: 'PreToolUse', matcher: 'Bash', type: 'command', command: 'c', timeout: 15 },
    ])
  })
  it('manifest 内联的钩子对象（带或不带外层 hooks）也读，没有钩子返回空', () => {
    manifest({ hooks: { Stop: [{ hooks: [cmd('x')] }] } })
    expect(pluginHooks(root).map(h => h.event)).toEqual(['Stop'])
    manifest({ Notification: [{ hooks: [cmd('y')] }] })
    expect(pluginHooks(root).map(h => h.event)).toEqual(['Notification'])
    manifest()
    expect(pluginHooks(root)).toEqual([])
    expect(pluginHooks(join(root, 'nope'))).toEqual([])
  })
  it('manifest 路径指到包外时不读', () => {
    const pkg = join(root, 'pkg')
    mkdirSync(join(pkg, '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(pkg, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'hooky', hooks: ['../outside.json'] }),
    )
    writeFileSync(join(root, 'outside.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [cmd('x')] }] } }))
    expect(pluginHooks(pkg)).toEqual([])
  })
  it('目录链接（junction）指到包外时不读，包外文件内容不会进列表', () => {
    const pkg = join(root, 'pkg'),
      outside = join(root, 'outside')
    mkdirSync(join(pkg, '.claude-plugin'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(outside, 'h.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [cmd('x')] }] } }))
    symlinkSync(outside, join(pkg, 'hooks'), 'junction')
    writeFileSync(join(pkg, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'hooky', hooks: ['./hooks/h.json'] }))
    expect(pluginHooks(pkg)).toEqual([])
  })
  it('最多 200 条，单条命令截 2000 字符', () => {
    manifest()
    mkdirSync(join(root, 'hooks'))
    const many = Array.from({ length: 250 }, () => cmd('x'.repeat(3000)))
    writeFileSync(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: many }] } }))
    const hooks = pluginHooks(root)
    expect(hooks).toHaveLength(200)
    expect(hooks[0].command).toHaveLength(2000)
  })
})
