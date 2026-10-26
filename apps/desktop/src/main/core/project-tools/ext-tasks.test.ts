import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtTaskTemplate, ExtTaskTemplateWire } from '@pixelsky/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readExtTaskGroups, runExtract, sanitizeTemplates } from './ext-tasks'
import { readRunTasks } from './run-tasks'

const wire = (template: ExtTaskTemplate, index = 0): ExtTaskTemplateWire => ({
  packKey: 'k1',
  packId: 'pixelsky.test',
  index,
  template,
})

const JUST: ExtTaskTemplate = {
  id: 'just',
  label: 'Just',
  files: ['justfile'],
  extract: [{ pattern: '^([a-z][\\w-]*)\\s*:', flags: 'm', name: 1, description: { commentBefore: '#' } }],
  command: 'just {name}',
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ext-tasks-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('sanitizeTemplates', () => {
  it('不是数组就是空', () => {
    expect(sanitizeTemplates({ a: 1 })).toEqual({ templates: [], dropped: 0 })
  })

  it('最多 100 条，多的计入 dropped', () => {
    const raw = Array.from({ length: 105 }, (_, i) => wire(JUST, i))
    const { templates, dropped } = sanitizeTemplates(raw)
    expect(templates).toHaveLength(100)
    expect(dropped).toBe(5)
  })

  it('字段类型不对的条目被丢掉并计数', () => {
    const { templates, dropped } = sanitizeTemplates([wire(JUST), { packKey: 1 }, null, { ...wire(JUST), index: -1 }])
    expect(templates).toHaveLength(1)
    expect(dropped).toBe(3)
  })
})

describe('runExtract', () => {
  it('返回下标和各组，groups[0] 是整段匹配', () => {
    const hit = runExtract('a: x\nbuild: y', { pattern: '^(\\w+):', flags: 'm', name: 1 })
    expect(hit).toEqual([
      { index: 0, groups: ['a:', 'a'] },
      { index: 5, groups: ['build:', 'build'] },
    ])
  })

  it('灾难性回溯的正则会超时而不是卡住', () => {
    const start = Date.now()
    const hit = runExtract('a'.repeat(40), { pattern: '(a|aa)*b', name: 0 })
    expect(hit).toBe('timeout')
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('写错的正则当作没有匹配', () => {
    expect(runExtract('abc', { pattern: '(', name: 0 })).toEqual([])
  })
})

describe('readExtTaskGroups', () => {
  it('从 justfile 提取任务，说明取前一行注释', async () => {
    await writeFile(join(root, 'justfile'), '# 编译\nbuild:\n  cargo build\n\ntest:\n  cargo test\n')
    const { groups, truncated } = await readExtTaskGroups(root, [wire(JUST)])
    expect(truncated).toBe(false)
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.kind).toBe('ext')
    expect(g.file).toBe('justfile')
    expect(g.ext).toMatchObject({
      packKey: 'k1',
      templateId: 'just',
      command: 'just {name}',
      cwd: '{dir}',
      runner: null,
    })
    expect(g.tasks).toEqual([
      { name: 'build', detail: '', line: 2, extDetail: '编译' },
      { name: 'test', detail: '', line: 5 },
    ])
  })

  it('在子文件夹里找，跳过 node_modules 和含引号的文件夹', async () => {
    await mkdir(join(root, 'sub'))
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, "it's"))
    for (const dir of ['sub', 'node_modules', "it's"]) await writeFile(join(root, dir, 'justfile'), 'x:\n')
    const { groups } = await readExtTaskGroups(root, [wire(JUST)])
    expect(groups.map(g => g.file)).toEqual(['sub/justfile'])
    expect(groups[0].dir).toBe('sub')
  })

  it('files 带 * 时按通配认（不分大小写），每个认到的文件各成一组', async () => {
    const DOTNET: ExtTaskTemplate = {
      id: 'dotnet',
      label: '.NET',
      files: ['*.csproj'],
      tasks: [{ name: 'build' }],
      command: 'dotnet {name} {file}',
    }
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'App.CSPROJ'), '<Project />')
    await writeFile(join(root, 'src', 'App.csproj.user'), '<Project />')
    await writeFile(join(root, 'Lib.csproj'), '<Project />')
    const { groups } = await readExtTaskGroups(root, [wire(DOTNET)])
    expect(groups.map(g => g.file)).toEqual(['Lib.csproj', 'src/App.CSPROJ'])
  })

  it('含弯单引号（PowerShell 也当引号）的文件夹不读', async () => {
    await mkdir(join(root, 'sub'))
    const bad = ['x\u2019; calc; \u2018y', 'a\u2018b', 'a\u201Ab', 'a\u201Bb']
    for (const name of bad) await mkdir(join(root, name))
    for (const dir of ['sub', ...bad]) await writeFile(join(root, dir, 'justfile'), 'x:\n')
    const { groups } = await readExtTaskGroups(root, [wire(JUST)])
    expect(groups.map(g => g.file)).toEqual(['sub/justfile'])
  })

  it('不安全的任务名被过滤', async () => {
    const template: ExtTaskTemplate = {
      id: 'x',
      label: 'X',
      files: ['tasks.txt'],
      extract: [{ pattern: '^task (.+)$', flags: 'm', name: 1 }],
      command: 'run {name}',
    }
    await writeFile(join(root, 'tasks.txt'), 'task ok\ntask a;rm -rf /\ntask $(x)\ntask fine.2\n')
    const { groups } = await readExtTaskGroups(root, [wire(template)])
    expect(groups[0].tasks.map(t => t.name)).toEqual(['ok', 'fine.2'])
  })

  it('固定任务的 when：contains 和 exists，支持取反', async () => {
    const template: ExtTaskTemplate = {
      id: 'mvn',
      label: 'Maven',
      files: ['pom.xml'],
      tasks: [
        { name: 'compile' },
        { name: 'boot', description: '启动', when: 'contains:spring-boot' },
        { name: 'noboot', when: '!contains:spring-boot' },
        { name: 'wrapped', when: 'exists:mvnw' },
        { name: 'bare', when: '!exists:mvnw' },
      ],
      command: 'mvn {name}',
    }
    await writeFile(join(root, 'pom.xml'), '<artifactId>spring-boot</artifactId>')
    await writeFile(join(root, 'mvnw'), '')
    const { groups } = await readExtTaskGroups(root, [wire(template)])
    expect(groups[0].tasks.map(t => t.name)).toEqual(['compile', 'boot', 'wrapped'])
    expect(groups[0].tasks[1].extDetail).toBe('启动')
  })

  describe('运行器', () => {
    const mvn: ExtTaskTemplate = {
      id: 'mvn',
      label: 'Maven',
      files: ['pom.xml'],
      tasks: [{ name: 'package' }],
      runner: { windows: 'mvnw.cmd', default: './mvnw', fallback: 'mvn', when: 'exists:mvnw' },
      command: '{runner} {name}',
    }
    const io = (platform: NodeJS.Platform, existing: string[]) => ({
      read: async () => '<project/>',
      exists: async (path: string) => existing.some(name => path.endsWith(name)),
      platform,
    })

    it('Windows 用 windows 写法；文件在项目里时 runnerLocal 为 true', async () => {
      await writeFile(join(root, 'pom.xml'), '')
      await writeFile(join(root, 'mvnw.cmd'), '')
      await writeFile(join(root, 'mvnw'), '')
      const { groups } = await readExtTaskGroups(root, [wire(mvn)], io('win32', ['mvnw.cmd', 'mvnw']))
      expect(groups[0].ext).toMatchObject({ runner: 'mvnw.cmd', runnerLocal: true })
    })

    it('其他平台用 default', async () => {
      await writeFile(join(root, 'pom.xml'), '')
      const { groups } = await readExtTaskGroups(root, [wire(mvn)], io('linux', ['mvnw', 'pom.xml']))
      expect(groups[0].ext).toMatchObject({ runner: './mvnw', runnerLocal: true })
    })

    it('when 不成立用 fallback，runnerLocal 为 false', async () => {
      await writeFile(join(root, 'pom.xml'), '')
      const { groups } = await readExtTaskGroups(root, [wire(mvn)], io('win32', ['mvn']))
      expect(groups[0].ext).toMatchObject({ runner: 'mvn', runnerLocal: false })
    })
  })

  it('一个提取规则超时：其他任务照列，truncated 为 true', async () => {
    const template: ExtTaskTemplate = {
      id: 'slow',
      label: 'Slow',
      files: ['slow.txt'],
      tasks: [{ name: 'fixed' }],
      extract: [
        { pattern: '(a|aa)*b(c)', name: 1 },
        { pattern: '^t:(\\w+)$', flags: 'm', name: 1 },
      ],
      command: 'x {name}',
    }
    await writeFile(join(root, 'slow.txt'), `${'a'.repeat(40)}\nt:other\n`)
    const start = Date.now()
    const { groups, truncated } = await readExtTaskGroups(root, [wire(template)])
    expect(Date.now() - start).toBeLessThan(1000)
    expect(truncated).toBe(true)
    expect(groups[0].tasks.map(t => t.name)).toEqual(['fixed', 'other'])
  })

  it('没有模板就不读文件', async () => {
    expect(await readExtTaskGroups(root, [])).toEqual({ groups: [], truncated: false })
  })

  it('readRunTasks 把扩展组排在内置组后面', async () => {
    await writeFile(join(root, 'justfile'), 'build:\n')
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    const state = await readRunTasks(root, [wire(JUST)])
    expect(state.groups.map(g => g.kind)).toEqual(['npm', 'ext'])
    expect((await readRunTasks(root)).groups.map(g => g.kind)).toEqual(['npm'])
  })
})
