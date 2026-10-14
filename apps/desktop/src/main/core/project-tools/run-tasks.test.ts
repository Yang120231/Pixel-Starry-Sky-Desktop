import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRunTasks } from './run-tasks'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'run-tasks-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(rel: string, text: string) {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), text)
}
const pkg = (scripts: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'x', scripts, ...extra }, null, 2)

describe('readRunTasks', () => {
  it('reads npm, make and cargo groups with root first in fixed order', async () => {
    await put('Cargo.toml', '[package]\nname = "a"\n')
    await put('Makefile', 'build:\n\techo hi\n')
    await put('package.json', pkg({ dev: 'vite', 'test:unit': 'vitest' }))
    const state = await readRunTasks(root)
    expect(state.root).toBe(root)
    expect(state.truncated).toBe(false)
    expect(state.groups.map(g => [g.kind, g.file, g.dir])).toEqual([
      ['npm', 'package.json', ''],
      ['make', 'Makefile', ''],
      ['cargo', 'Cargo.toml', ''],
    ])
    expect(state.groups[0].manager).toBe('npm')
    expect(state.groups[0].tasks.map(t => [t.name, t.detail])).toEqual([
      ['dev', 'vite'],
      ['test:unit', 'vitest'],
    ])
  })

  it('computes 1-based script lines and ignores invalid scripts', async () => {
    await put('package.json', pkg({ dev: 'vite', 'bad key': 'x', num: 1, build: 'tsc' }))
    const [group] = (await readRunTasks(root)).groups
    expect(group.tasks.map(t => [t.name, t.line])).toEqual([
      ['dev', 4],
      ['build', 7],
    ])
  })

  it('inherits the package manager from the root lockfile in a monorepo', async () => {
    await put('pnpm-lock.yaml', '')
    await put('package.json', pkg({ a: 'x' }))
    await put('apps/web/package.json', pkg({ b: 'y' }))
    await put('apps/api/package.json', pkg({ c: 'z' }, { packageManager: 'yarn@4.0.0' }))
    const { groups } = await readRunTasks(root)
    expect(groups.map(g => [g.dir, g.manager])).toEqual([
      ['', 'pnpm'],
      ['apps/api', 'yarn'],
      ['apps/web', 'pnpm'],
    ])
  })

  it('skips ignored folders, dot folders and anything deeper than 3 levels', async () => {
    const body = pkg({ a: 'x' })
    for (const dir of ['node_modules/p', '.git/x', '.hidden', 'dist', 'build', 'out', 'target', 'vendor', 'a/b/c/d'])
      await put(`${dir}/package.json`, body)
    await put('a/b/c/package.json', body)
    const { groups } = await readRunTasks(root)
    expect(groups.map(g => g.file)).toEqual(['a/b/c/package.json'])
  })

  it('does not follow symlinked folders', async () => {
    await put('real/package.json', pkg({ a: 'x' }))
    try {
      await symlink(join(root, 'real'), join(root, 'link'), 'junction')
    } catch {
      return
    }
    expect((await readRunTasks(root)).groups.map(g => g.file)).toEqual(['real/package.json'])
  })

  it('caps manifests at 30 files and flags truncated', async () => {
    for (let i = 0; i < 35; i++) await put(`p${String(i).padStart(2, '0')}/package.json`, pkg({ a: 'x' }))
    const state = await readRunTasks(root)
    expect(state.groups).toHaveLength(30)
    expect(state.truncated).toBe(true)
  })

  it('filters Makefile targets', async () => {
    await put(
      'Makefile',
      [
        '.PHONY: all clean',
        'CC := gcc',
        'X ::= 1',
        'all: build',
        '%.o: %.c',
        '$(OBJ): dep',
        'build:',
        '\tcc',
        'build:',
        'test-1.x: build',
        '  indented:',
        '',
      ].join('\n'),
    )
    const [group] = (await readRunTasks(root)).groups
    expect(group.tasks.map(t => [t.name, t.line, t.detail])).toEqual([
      ['all', 4, ''],
      ['build', 7, ''],
      ['test-1.x', 10, ''],
    ])
  })

  it('reads GNUmakefile names', async () => {
    await put('sub/GNUmakefile', 'go:\n')
    const [group] = (await readRunTasks(root)).groups
    expect(group.file).toBe('sub/GNUmakefile')
  })

  it('cargo needs [package] or [workspace]', async () => {
    await put('Cargo.toml', '[workspace]\nmembers = ["a"]\n')
    await put('crates/a/Cargo.toml', '[package]\nname = "a"\n')
    await put('crates/my lib/Cargo.toml', '[package]\nname = "b"\n')
    await put('crates/none/Cargo.toml', '[dependencies]\n')
    const { groups } = await readRunTasks(root)
    expect(groups.map(g => g.file)).toEqual(['Cargo.toml', 'crates/a/Cargo.toml', 'crates/my lib/Cargo.toml'])
    expect(groups[0].tasks.map(t => t.name)).toEqual(['build', 'check', 'test'])
    expect(groups[0].tasks[0]).toEqual({ name: 'build', detail: 'cargo build', line: null })
    expect(groups[1].tasks.map(t => t.name)).toEqual(['build', 'check', 'test', 'run'])
    expect(groups[1].tasks[3].detail).toBe('cargo run --manifest-path crates/a/Cargo.toml')
    expect(groups[2].tasks[0].detail).toBe('cargo build --manifest-path "crates/my lib/Cargo.toml"')
  })

  it('ignores invalid JSON and package.json without scripts', async () => {
    await put('package.json', '{ not json')
    await put('a/package.json', JSON.stringify({ name: 'x' }))
    expect((await readRunTasks(root)).groups).toEqual([])
  })
})
