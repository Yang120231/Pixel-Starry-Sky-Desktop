import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexMcp, ExtensionService } from './service'
import { MASKED_SECRET } from '@pixelsky/engine'
import type { ExtensionScope } from '@pixelsky/protocol'
let root: string, service: ExtensionService, project: string
const global: ExtensionScope = { kind: 'global' }
const cipher = {
  available: () => true,
  encrypt: (text: string) => Buffer.from(text).toString('base64'),
  decrypt: (text: string) => Buffer.from(text, 'base64').toString('utf8'),
}
beforeEach(() => {
  const scratch = resolve('../../scratch')
  mkdirSync(scratch, { recursive: true })
  root = mkdtempSync(join(scratch, 'extension-service-'))
  project = join(root, 'project')
  mkdirSync(project)
  service = new ExtensionService(join(root, 'extensions'), cipher, () => ({
    ...process.env,
    CLAUDE_CONFIG_DIR: join(root, 'native'),
  }))
})
afterEach(() => {
  service.close()
  rmSync(root, { recursive: true, force: true })
})
describe('管理配置与凭据', () => {
  it('Codex 扩展与旧 Claude 配置分流，MCP 使用原生配置，技能使用真实目录', () => {
    service.upsert({
      kind: 'mcp',
      name: 'codex-tools',
      scope: global,
      engines: ['codex'],
      mcp: { type: 'stdio', command: process.execPath, args: ['--version'], env: { TOKEN: 'private-codex' } },
    })
    service.upsert({
      kind: 'skill',
      name: 'codex-skill',
      scope: global,
      engines: ['codex'],
      text: '---\nname: codex-skill\ndescription: test\n---\nRead project files.',
    })
    const cx = service.launch(project, 'codex'),
      cc = service.launch(project, 'claude')
    expect(cx.pluginDirs).toEqual([])
    expect(cx.skillRoots).toHaveLength(1)
    expect(cx.codexConfig?.['mcp_servers."codex-tools"']).toMatchObject({
      command: process.execPath,
      env: {},
      env_vars: ['TOKEN'],
    })
    // 凭据只进 Codex 进程环境，不进 -c 命令行
    expect(cx.env).toEqual({ TOKEN: 'private-codex' })
    expect(JSON.stringify(cx.codexConfig)).not.toContain('private-codex')
    expect(cc.pluginDirs).toEqual([])
    expect(cc.mcpFile).toBeUndefined()
    expect(readFileSync(join(service.dir, 'config.json'), 'utf8')).not.toContain('private-codex')
  })
  it('凭据无法解密时仍能显示其他配置，重新填写前保留原加密文件', () => {
    const dir = join(root, 'broken')
    mkdirSync(dir)
    writeFileSync(join(dir, 'secrets.json'), 'old ciphertext')
    const broken = new ExtensionService(
      dir,
      {
        ...cipher,
        decrypt: () => {
          throw new Error('decrypt failed')
        },
      },
      () => ({ CLAUDE_CONFIG_DIR: join(root, 'native') }),
    )
    expect(broken.state(null).warnings.join('')).toContain('无法解密')
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).toBe('old ciphertext')
  })
  it('列表与配置遮掩凭据，重启后生成启动配置，关闭时删临时文件', () => {
    const e = service.upsert({
      kind: 'mcp',
      name: 'remote',
      scope: global,
      mcp: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer private-token' } },
    })
    expect(readFileSync(join(service.dir, 'config.json'), 'utf8')).not.toContain('private-token')
    expect(service.state(null).entries[0].mcp?.headers).toEqual({ Authorization: MASKED_SECRET })
    service.upsert({ ...e, mcp: { ...e.mcp, headers: { Authorization: MASKED_SECRET } } })
    const restarted = new ExtensionService(service.dir, cipher, () => ({
        ...process.env,
        CLAUDE_CONFIG_DIR: join(root, 'native'),
      })),
      launch = restarted.launch(project)
    expect(readFileSync(launch.mcpFile!, 'utf8')).toContain('private-token')
    launch.dispose?.()
    expect(existsSync(launch.mcpFile!)).toBe(false)
  })
  it('额外 MCP 服务器（对话历史）：Claude 只有它时也写文件，Codex 凭据走环境变量，key 随地址变化且不含令牌', () => {
    const history = (port: number, token = 'history-secret') => ({
      pixelsky_history: {
        type: 'http' as const,
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
      },
    })
    const none = service.launch(project, 'claude')
    expect(none.mcpFile).toBeUndefined()
    const cc = service.launch(project, 'claude', {}, history(5001))
    expect(JSON.parse(readFileSync(cc.mcpFile!, 'utf8')).mcpServers.pixelsky_history).toEqual(
      history(5001).pixelsky_history,
    )
    expect(cc.key).toBe(none.key + '|pixelsky_history:http://127.0.0.1:5001/mcp')
    expect(cc.key).not.toContain('history-secret')
    const moved = service.launch(project, 'claude', {}, history(5002))
    expect(moved.key).not.toBe(cc.key)
    expect(service.launch(project, 'claude', {}, history(5001, 'other-token')).key).toBe(cc.key)
    cc.dispose?.()
    moved.dispose?.()
    expect(existsSync(cc.mcpFile!)).toBe(false)

    const cx = service.launch(project, 'codex', {}, history(5001))
    expect(cx.codexConfig?.['mcp_servers."pixelsky_history"']).toMatchObject({
      url: 'http://127.0.0.1:5001/mcp',
      env_http_headers: { Authorization: expect.stringMatching(/^PIXELSKY_MCP_SECRET_\d+$/) },
    })
    expect(Object.values(cx.env ?? {})).toEqual(['Bearer history-secret'])
    expect(JSON.stringify(cx.codexConfig)).not.toContain('history-secret')
    expect(cx.key).toBe(service.launch(project, 'codex').key + '|pixelsky_history:http://127.0.0.1:5001/mcp')
  })
  it('额外 MCP 服务器与扩展配置的服务器并存，同名时以应用提供的为准', () => {
    service.upsert({
      kind: 'mcp',
      name: 'pixelsky_history',
      scope: global,
      mcp: { type: 'http', url: 'https://example.com/fake' },
    })
    service.upsert({
      kind: 'mcp',
      name: 'remote',
      scope: global,
      mcp: { type: 'http', url: 'https://example.com/mcp' },
    })
    const launch = service.launch(
      project,
      'claude',
      {},
      { pixelsky_history: { type: 'http', url: 'http://127.0.0.1:1/mcp' } },
    )
    const servers = JSON.parse(readFileSync(launch.mcpFile!, 'utf8')).mcpServers
    expect(servers.remote.url).toBe('https://example.com/mcp')
    expect(servers.pixelsky_history.url).toBe('http://127.0.0.1:1/mcp')
    launch.dispose?.()
  })
  it('相同范围重复失败，项目覆盖全局；其他项目变更不改变启动签名', () => {
    const config = { kind: 'mcp', name: 'remote', scope: global, mcp: { type: 'http', url: 'https://example.com/mcp' } }
    service.upsert(config)
    expect(() => service.upsert(config)).toThrow('同名')
    const before = service.launch(project)
    before.dispose?.()
    const other = join(root, 'other')
    mkdirSync(other)
    service.upsert({ ...config, scope: { kind: 'project', path: other }, enabled: false })
    const after = service.launch(project)
    after.dispose?.()
    expect(after.key).toBe(before.key)
    service.upsert({ ...config, scope: { kind: 'project', path: project }, enabled: false })
    expect(service.launch(project).mcpFile).toBeUndefined()
  })
  it('创建技能、保留支持文件与 CRLF / BOM，外部版本冲突拒绝保存', async () => {
    const src = join(root, 'skill')
    mkdirSync(src)
    writeFileSync(join(src, 'SKILL.md'), '\uFEFF---\r\nname: run\r\ndescription: test\r\n---\r\n执行测试\r\n')
    writeFileSync(join(src, 'helper.txt'), 'support')
    const e = await service.import({ kind: 'skill', source: 'local', location: src, scope: global }),
      value = service.skillText(e.id, null)
    expect((await service.update(e.id, false)).changed).toBe(false)
    expect(service.commands(null)[0].name).toBe('run:run')
    const next = service.upsert({
      ...e,
      text: value.text.replace('执行测试', '新的步骤'),
      expectedVersion: value.version,
    })
    await expect(service.update(next.id, true)).rejects.toThrow('本地编辑')
    const path = next.components[0].path!
    expect(readFileSync(path, 'utf8')).toContain('\uFEFF---\r\n')
    expect(readFileSync(join(path, '../helper.txt'), 'utf8')).toBe('support')
    writeFileSync(path, '外部修改')
    expect(() => service.upsert({ ...next, text: value.text, expectedVersion: value.version })).toThrow('外部修改')
    await expect(service.update(next.id, true)).rejects.toThrow('本地编辑')
  })
  it('本地插件组件投影与更新，停用移除不删除原始目录', async () => {
    const src = join(root, 'plugin')
    mkdirSync(join(src, '.claude-plugin'), { recursive: true })
    writeFileSync(join(src, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tools', version: '1.0' }))
    mkdirSync(join(src, 'skills/test'), { recursive: true })
    writeFileSync(join(src, 'skills/test/SKILL.md'), '---\nname: test\ndescription: checks\n---\n步骤')
    const e = await service.import({ kind: 'plugin', source: 'local', location: src, scope: global })
    expect(service.launch(project).pluginDirs).toEqual([e.path])
    expect((await service.update(e.id, false)).changed).toBe(false)
    writeFileSync(join(src, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tools', version: '2.0' }))
    expect((await service.update(e.id, false)).changed).toBe(true)
    expect((await service.update(e.id, true)).changed).toBe(true)
    service.toggle(e.id, false)
    expect(service.launch(project).pluginDirs).toEqual([])
    service.remove(e.id)
    expect(existsSync(src)).toBe(true)
  })
  it('不能加密时凭据只在内存，重启会要求重新填写', () => {
    const path = join(root, 'transient'),
      transient = new ExtensionService(path, { ...cipher, available: () => false }, () => ({
        CLAUDE_CONFIG_DIR: join(root, 'native'),
      }))
    transient.upsert({
      kind: 'mcp',
      name: 'remote',
      scope: global,
      mcp: { type: 'http', url: 'https://example.com', headers: { key: 'private' } },
    })
    expect(existsSync(join(path, 'secrets.json'))).toBe(false)
    expect(() => new ExtensionService(path, { ...cipher, available: () => false }).launch(project)).toThrow(
      '凭据未保存',
    )
  })
  it('JSON 批量导入在校验阶段失败时不写入部分配置', () => {
    expect(() =>
      service.importMcp(
        '{"mcpServers":{"ok":{"type":"http","url":"https://example.com"},"bad":{"type":"invalid"}}}',
        global,
      ),
    ).toThrow()
    expect(service.state(null).entries).toEqual([])
  })
})

describe('codexMcp', () => {
  it('HTTP 请求头按变量名引用；stdio 同名不同值时留在配置里', () => {
    const r = codexMcp(
      {
        a: { type: 'stdio', command: 'a', env: { SHARED: '1', ONLY_A: 'x', HOME_X: 'mine' } },
        b: { type: 'stdio', command: 'b', env: { SHARED: '2' } },
        h: { type: 'http', url: 'https://m.example/mcp', headers: { Authorization: 'Bearer s3cret' } },
      },
      { HOME_X: 'theirs' },
    )
    expect(r.codexConfig['mcp_servers."a"']).toEqual({
      command: 'a',
      args: [],
      env: { SHARED: '1', HOME_X: 'mine' },
      env_vars: ['ONLY_A'],
    })
    expect(r.codexConfig['mcp_servers."b"']).toEqual({ command: 'b', args: [], env: { SHARED: '2' } })
    expect(r.codexConfig['mcp_servers."h"']).toEqual({
      url: 'https://m.example/mcp',
      env_http_headers: { Authorization: 'PIXELSKY_MCP_SECRET_0' },
    })
    expect(r.env).toEqual({ ONLY_A: 'x', PIXELSKY_MCP_SECRET_0: 'Bearer s3cret' })
  })
})
