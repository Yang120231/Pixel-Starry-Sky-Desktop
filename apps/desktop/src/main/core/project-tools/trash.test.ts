import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { moveToTrash } from './trash'

let root: string, repo: string, trash: string
beforeEach(async () => {
  const scratch = resolve('../../scratch')
  await mkdir(scratch, { recursive: true })
  root = await mkdtemp(join(scratch, 'trash-unit-'))
  repo = join(root, 'repo')
  trash = join(root, 'data', 'trash')
  await mkdir(join(repo, 'src'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
})

const file = async (relative: string, text: string) => {
  await writeFile(join(repo, relative), text)
  return { absolute: join(repo, relative), relative }
}

describe('remote trash for discarded files', () => {
  it('moves one discard into one timestamped folder, keeping the layout', async () => {
    const now = new Date('2026-10-09T12:34:56.789Z')
    const dir = await moveToTrash(trash, [await file('a.txt', 'A'), await file('src/b.txt', 'B')], { now })
    expect(dir).toBe(join(trash, '2026-10-09T12-34-56-789Z'))
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('A')
    expect(await readFile(join(dir, 'src', 'b.txt'), 'utf8')).toBe('B')
    expect(existsSync(join(repo, 'a.txt'))).toBe(false)
    expect(existsSync(join(repo, 'src', 'b.txt'))).toBe(false)
  })

  it('numbers folders with the same timestamp', async () => {
    const now = new Date('2026-10-09T00:00:00.000Z')
    const first = await moveToTrash(trash, [await file('a.txt', '1')], { now })
    const second = await moveToTrash(trash, [await file('a.txt', '2')], { now })
    expect(second).toBe(first + '-1')
    expect(await readFile(join(second, 'a.txt'), 'utf8')).toBe('2')
    expect((await readdir(trash)).length).toBe(2)
  })

  it('copies and deletes across file systems', async () => {
    const moves: string[] = []
    const dir = await moveToTrash(trash, [await file('a.txt', 'A')], {
      move: async from => {
        moves.push(from)
        throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
      },
    })
    expect(moves).toEqual([join(repo, 'a.txt')])
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('A')
    expect(existsSync(join(repo, 'a.txt'))).toBe(false)
  })

  it('stops on other errors and refuses paths outside the folder', async () => {
    const a = await file('a.txt', 'A')
    await expect(
      moveToTrash(trash, [a], {
        move: async () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        },
      }),
    ).rejects.toThrow('denied')
    expect(existsSync(a.absolute)).toBe(true)
    await expect(
      moveToTrash(trash, [{ absolute: a.absolute, relative: '../escape.txt' }], { move: rename }),
    ).rejects.toThrow('参数不正确')
    expect(existsSync(a.absolute)).toBe(true)
  })
})
