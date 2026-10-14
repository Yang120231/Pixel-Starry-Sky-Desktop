import { describe, expect, it } from 'vitest'
import type { RunTaskGroup } from '../../../../../shared/types/project-tools'
import type { TerminalRecord } from '../../../../../shared/types/terminal'
import {
  exitSuffix,
  filterGroups,
  isCollapsed,
  isTaskFile,
  npmGroupForFile,
  taskCommand,
  taskKey,
  taskStatus,
  visibleRows,
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
    expect(npmGroupForFile(state, 'd:\\p\\', 'apps/desktop/package.json')?.dir).toBe('apps/desktop')
    expect(npmGroupForFile(state, 'D:/p', 'package.json')?.dir).toBe('')
    expect(npmGroupForFile(state, 'D:/other', 'package.json')).toBeNull()
    expect(npmGroupForFile(null, 'D:/p', 'package.json')).toBeNull()
  })
})
