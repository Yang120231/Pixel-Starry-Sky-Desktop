import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findMissingFolders, folderExists, localSessions } from './folders'
import { PrLinkStore } from './links'

const dirs: string[] = []
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})
const temp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'ps-status-'))
  dirs.push(dir)
  return dir
}

const ID = '11111111-1111-1111-1111-111111111111'

describe('localSessions', () => {
  it('keeps local, non-archived sessions with a cwd', () => {
    const list = localSessions([
      { id: 'a', cwd: '/x', archived: false },
      { id: 'b', cwd: '/x', archived: true },
      { id: 'c', cwd: '', archived: false },
      { id: `ssh-abc123~${ID}`, cwd: '/x', archived: false },
      { id: `wsl-abc123~${ID}`, cwd: '/x', archived: false },
    ])
    expect(list.map(s => s.id)).toEqual(['a'])
  })
})

describe('findMissingFolders', () => {
  it('detects a folder that was created and then deleted', async () => {
    const root = await temp()
    const dir = join(root, 'work')
    await import('node:fs/promises').then(fs => fs.mkdir(dir))
    const sessions = [
      { id: 's1', cwd: dir, archived: false },
      { id: 's2', cwd: dir, archived: false },
      { id: 's3', cwd: root, archived: false },
    ]
    expect(await findMissingFolders(sessions)).toEqual({})
    await rm(dir, { recursive: true })
    expect(await findMissingFolders(sessions)).toEqual({ s1: true, s2: true })
  })
  it('stats each distinct cwd once and treats errors as present', async () => {
    const seen: string[] = []
    const missing = await findMissingFolders(
      [
        { id: 'a', cwd: '/p', archived: false },
        { id: 'b', cwd: '/p', archived: false },
        { id: 'c', cwd: '/q', archived: false },
        { id: 'd', cwd: '/boom', archived: false },
      ],
      async path => {
        seen.push(path)
        if (path === '/boom') throw new Error('x')
        return path !== '/p'
      },
    )
    expect(seen.sort()).toEqual(['/boom', '/p', '/q'])
    expect(missing).toEqual({ a: true, b: true })
  })
  it('a file is not a folder', async () => {
    const root = await temp()
    const file = join(root, 'f.txt')
    await writeFile(file, 'x')
    expect(await folderExists(file)).toBe(false)
    expect(await folderExists(root)).toBe(true)
    expect(await folderExists(join(root, 'nope'))).toBe(false)
  })
})

describe('PrLinkStore', () => {
  it('keeps at most 10 per session, persists atomically and reloads', async () => {
    const root = await temp()
    const file = join(root, 'session-status', 'prs.json')
    const store = new PrLinkStore(file)
    await store.load()
    expect(store.add('s', ['https://github.com/o/r/pull/1'], true)).toBe(true)
    expect(store.add('s', ['https://github.com/o/r/pull/1'], true)).toBe(false)
    for (let i = 2; i <= 14; i++) store.add('s', [`https://github.com/o/r/pull/${i}`], true)
    await store.flush()
    const again = new PrLinkStore(file)
    await again.load()
    expect(again.get('s')).toHaveLength(10)
    expect(again.get('s')[9]).toBe('https://github.com/o/r/pull/14')
    expect(again.get('s')[0]).toBe('https://github.com/o/r/pull/5')
    again.retain(new Set(['other']))
    expect(again.get('s')).toEqual([])
  })

  it('old files (session → url array) load as mentioned; own and mentioned are kept apart', async () => {
    const root = await temp()
    const file = join(root, 'prs.json')
    await writeFile(file, JSON.stringify({ s: ['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/2'] }))
    const store = new PrLinkStore(file)
    await store.load()
    expect(store.get('s')).toEqual([])
    expect(store.mentioned('s')).toHaveLength(2)
    expect(store.add('s', ['https://github.com/o/r/pull/3'])).toBe(false)
    expect(store.add('s', ['https://github.com/o/r/pull/1'], true)).toBe(true)
    expect(store.mentioned('s')).toEqual(['https://github.com/o/r/pull/2', 'https://github.com/o/r/pull/3'])
    await store.flush()
    const again = new PrLinkStore(file)
    await again.load()
    expect(again.get('s')).toEqual(['https://github.com/o/r/pull/1'])
    expect(again.mentioned('s')).toHaveLength(2)
  })
})
