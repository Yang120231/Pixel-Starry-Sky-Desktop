import { describe, expect, it } from 'vitest'
import type { RunTaskGroup } from '../../../../../shared/types/project-tools'
import type { TerminalRecord } from '../../../../../shared/types/terminal'
import {
  categoryKey,
  exitSuffix,
  filterGroups,
  gradleBuildKey,
  gutterGroupForFile,
  isCategoryCollapsed,
  isCollapsed,
  isTaskFile,
  mergeGradleFull,
  PROPERTIES,
  rowKey,
  taskCommand,
  taskKey,
  taskStatus,
  taskTitle,
  visibleRows,
  type GradleFull,
} from './model'

const task = (name: string, detail = '') => ({ name, detail, line: null })
const npm = (dir: string, manager: RunTaskGroup['manager']): RunTaskGroup => ({
  kind: 'npm',
  file: dir ? `${dir}/package.json` : 'package.json',
  dir,
  manager,
  tasks: [task('build', 'tsc')],
})
const record = (patch: Partial<TerminalRecord>): TerminalRecord => ({
  id: 't',
  projectId: 'p',
  projectName: 'p',
  cwd: '/',
  profileId: 'x',
  profileLabel: 'x',
  title: 'x',
  titleEdited: false,
  status: 'running',
  generation: 1,
  createdAt: 0,
  ...patch,
})

describe('taskCommand', () => {
  it('根目录不带目录参数', () => {
    for (const m of ['npm', 'pnpm', 'yarn', 'bun'] as const)
      expect(taskCommand(npm('', m), task('dev'))).toBe(`${m} run dev`)
  })
  it('子目录用各工具自己的参数', () => {
    expect(taskCommand(npm('apps/web', 'pnpm'), task('dev'))).toBe('pnpm --dir apps/web run dev')
    expect(taskCommand(npm('apps/web', 'npm'), task('dev'))).toBe('npm --prefix apps/web run dev')
    expect(taskCommand(npm('apps/web', 'yarn'), task('dev'))).toBe('yarn --cwd apps/web run dev')
    expect(taskCommand(npm('apps/web', 'bun'), task('dev'))).toBe('bun --cwd apps/web run dev')
  })
  it('没有包管理器时用 npm；目录带空格加引号', () => {
    expect(taskCommand(npm('my app', undefined), task('dev'))).toBe('npm --prefix "my app" run dev')
  })
  it('make 和 cargo', () => {
    const make: RunTaskGroup = { kind: 'make', file: 'Makefile', dir: '', tasks: [] }
    expect(taskCommand(make, task('clean'))).toBe('make clean')
    expect(taskCommand({ ...make, dir: 'sub dir' }, task('clean'))).toBe('make -C "sub dir" clean')
    const cargo: RunTaskGroup = { kind: 'cargo', file: 'src-tauri/Cargo.toml', dir: 'src-tauri', tasks: [] }
    expect(taskCommand(cargo, task('build'))).toBe('cargo build --manifest-path src-tauri/Cargo.toml')
    expect(taskCommand({ ...cargo, dir: '' }, task('test'))).toBe('cargo test')
    expect(taskCommand({ ...cargo, dir: 'a b' }, task('run'))).toBe('cargo run --manifest-path "a b/Cargo.toml"')
  })
})

describe('exitSuffix', () => {
  it('按程序名判断', () => {
    expect(exitSuffix('powershell.exe')).toBe('; exit $LASTEXITCODE')
    expect(exitSuffix('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('; exit $LASTEXITCODE')
    expect(exitSuffix('CMD.EXE')).toBe(' && exit 0 || exit 1')
    expect(exitSuffix('/usr/bin/fish')).toBe('; exit $status')
    expect(exitSuffix('/bin/zsh')).toBe('; exit $?')
    expect(exitSuffix('bash.exe')).toBe('; exit $?')
    expect(exitSuffix(undefined)).toBe('; exit $?')
  })
})

describe('taskStatus', () => {
  it('各种终端状态', () => {
    expect(taskStatus(undefined).kind).toBe('idle')
    expect(taskStatus(record({ status: 'starting' })).kind).toBe('running')
    expect(taskStatus(record({ status: 'running' })).kind).toBe('running')
    expect(taskStatus(record({ status: 'exited', exitCode: 0 })).kind).toBe('ok')
    expect(taskStatus(record({ status: 'exited', exitCode: 2 }))).toEqual({ kind: 'failed', code: 2 })
    expect(taskStatus(record({ status: 'running' }), true).kind).toBe('stopped')
    expect(taskStatus(record({ status: 'exited', exitCode: 0 }), true).kind).toBe('ok')
  })
})

describe('筛选与可见行', () => {
  const groups: RunTaskGroup[] = [
    { ...npm('', 'pnpm'), tasks: [task('dev', 'vite'), task('lint', 'eslint .')] },
    { ...npm('apps/desktop', 'pnpm'), tasks: [task('start', 'electron')] },
  ]
  it('按名字、命令、文件夹筛选', () => {
    expect(filterGroups(groups, '')).toHaveLength(2)
    expect(filterGroups(groups, 'LINT')[0].tasks.map(t => t.name)).toEqual(['lint'])
    expect(filterGroups(groups, 'electron')).toHaveLength(1)
    expect(filterGroups(groups, 'desktop')[0].tasks).toHaveLength(1)
    expect(filterGroups(groups, 'zzz')).toEqual([])
  })
  it('默认只展开根目录；可见行', () => {
    expect(isCollapsed(groups[0], {})).toBe(false)
    expect(isCollapsed(groups[1], {})).toBe(true)
    expect(isCollapsed(groups[1], { [groups[1].file]: false })).toBe(false)
    expect(visibleRows(groups, {}, false)).toHaveLength(4)
    expect(visibleRows(groups, {}, true)).toHaveLength(5)
  })
  it('任务键和任务文件', () => {
    expect(taskKey(groups[0], groups[0].tasks[0])).not.toBe(taskKey(groups[1], groups[1].tasks[0]))
    expect(isTaskFile('apps/x/package.json')).toBe(true)
    expect(isTaskFile('makefile')).toBe(true)
    expect(isTaskFile('src/Cargo.toml')).toBe(true)
    expect(isTaskFile('src/index.ts')).toBe(false)
  })
  it('编辑器文件对应的 npm 组', () => {
    const state = { root: 'D:/p', truncated: false, groups }
    expect(gutterGroupForFile(state, 'd:\\p\\', 'apps/desktop/package.json')?.dir).toBe('apps/desktop')
    expect(gutterGroupForFile(state, 'D:/p', 'package.json')?.dir).toBe('')
    expect(gutterGroupForFile(state, 'D:/other', 'package.json')).toBeNull()
    expect(gutterGroupForFile(null, 'D:/p', 'package.json')).toBeNull()
  })
})

describe('Gradle（§9）', () => {
  const gradle = (project: string, buildDir = '', wrapper = true): RunTaskGroup => ({
    kind: 'gradle',
    file: project === ':' ? `${buildDir ? buildDir + '/' : ''}build.gradle` : `${project.slice(1)}/build.gradle`,
    dir: project === ':' ? buildDir : project.slice(1),
    gradle: {
      buildDir,
      project,
      name: project === ':' ? 'ruby-mod' : project,
      wrapper,
      stamp: 's1',
      plugin: null,
      ...(project === ':' ? { properties: [{ key: 'mod_version', value: '1.2.0', line: 3, secret: false }] } : {}),
    },
    tasks: [
      { name: 'build', detail: '', line: null, category: 'build' },
      { name: 'runClient', detail: '', line: 7, category: 'fabric' },
      { name: 'dependencies', detail: '', line: null, category: 'help' },
    ],
  })
  const root = gradle(':')
  const fabric = gradle(':fabric')

  it('命令：wrapper、子项目、-p、cmd、没有 wrapper', () => {
    expect(taskCommand(root, root.tasks[0])).toBe('./gradlew build')
    expect(taskCommand(fabric, fabric.tasks[1])).toBe('./gradlew :fabric:runClient')
    expect(taskCommand(fabric, fabric.tasks[1], 'C:\\Windows\\System32\\cmd.exe')).toBe(
      '.\\gradlew.bat :fabric:runClient',
    )
    expect(taskCommand(fabric, fabric.tasks[1], 'pwsh.exe')).toBe('./gradlew :fabric:runClient')
    const nested = gradle(':', 'android')
    expect(taskCommand(nested, nested.tasks[0])).toBe('./android/gradlew -p android build')
    expect(taskCommand(nested, nested.tasks[0], 'cmd')).toBe('.\\android\\gradlew.bat -p android build')
    const spaced = gradle(':', 'my app')
    expect(taskCommand(spaced, spaced.tasks[0], 'pwsh')).toBe('& "./my app/gradlew" -p "my app" build')
    expect(taskCommand(gradle(':', '', false), root.tasks[0])).toBe('gradle build')
    expect(taskTitle(root, root.tasks[0])).toBe('build')
    expect(taskTitle(fabric, fabric.tasks[1])).toBe(':fabric:runClient')
  })

  it('可见行：属性、分组两层，help 和属性默认收起', () => {
    const rows = visibleRows([root], {}, false)
    expect(
      rows.map(r => (r.type === 'task' ? r.task.name : r.type === 'category' ? `[${r.category}]` : r.type)),
    ).toEqual(['group', `[${PROPERTIES}]`, '[build]', 'build', '[fabric]', 'runClient', '[help]'])
    expect(isCategoryCollapsed(root, 'help', {})).toBe(true)
    expect(isCategoryCollapsed(root, 'help', { [categoryKey(root, 'help')]: false })).toBe(false)
    // 展开属性；筛选时全部展开
    expect(visibleRows([root], { [categoryKey(root, PROPERTIES)]: false }, false).some(r => r.type === 'prop')).toBe(
      true,
    )
    expect(visibleRows([root], {}, true)).toHaveLength(9)
    expect(new Set(visibleRows([root], {}, true).map(rowKey)).size).toBe(9)
  })

  it('筛选：分组名、属性键和值；密的值不参与', () => {
    expect(filterGroups([root], 'fabric')[0].tasks.map(t => t.name)).toEqual(['runClient'])
    const byProp = filterGroups([root], '1.2.0')
    expect(byProp[0].tasks).toEqual([])
    expect(byProp[0].gradle?.properties).toHaveLength(1)
    const secret: RunTaskGroup = {
      ...root,
      gradle: { ...root.gradle!, properties: [{ key: 'TOKEN', value: '', line: 1, secret: true }] },
    }
    expect(filterGroups([secret], 'token')).toHaveLength(1)
  })

  it('完整列表替换推断的任务，行号和自己写的说明留着，Gradle 的说明放 description', () => {
    const state = { root: 'D:\\p', truncated: false, groups: [root, fabric, npm('', 'pnpm')] }
    const full: GradleFull = {
      at: 1,
      stamp: 's1',
      tasks: [
        { project: ':fabric', name: 'runClient', category: 'fabric', description: 'Starts the client' },
        { project: ':fabric', name: 'remapJar', category: 'fabric', description: 'Remaps the jar' },
        { project: ':', name: 'build', category: 'build', description: 'Assembles and tests' },
      ],
    }
    const merged = mergeGradleFull(state, new Map([[gradleBuildKey('d:/p/', ''), full]]))
    expect(merged.groups[1].tasks).toEqual([
      { name: 'runClient', detail: '', line: 7, category: 'fabric', description: 'Starts the client' },
      { name: 'remapJar', detail: '', line: null, category: 'fabric', description: 'Remaps the jar' },
    ])
    expect(merged.groups[0].tasks.map(t => t.name)).toEqual(['build'])
    expect(merged.groups[2]).toBe(state.groups[2])
    expect(mergeGradleFull(state, new Map())).toBe(state)
  })

  it('任务文件和编辑器 ▶', () => {
    expect(isTaskFile('fabric/build.gradle')).toBe(true)
    expect(isTaskFile('build.gradle.kts')).toBe(true)
    expect(isTaskFile('settings.gradle.kts')).toBe(true)
    expect(isTaskFile('gradle.properties')).toBe(true)
    expect(isTaskFile('gradle/wrapper/gradle-wrapper.properties')).toBe(true)
    expect(isTaskFile('app.gradle')).toBe(false)
    const state = { root: 'D:/p', truncated: false, groups: [root, fabric] }
    expect(gutterGroupForFile(state, 'D:/p', 'fabric/build.gradle')).toBe(fabric)
  })
})
