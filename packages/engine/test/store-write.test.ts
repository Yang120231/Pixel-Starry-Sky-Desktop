// 保存时改名替换文件：Windows 上目标被别的句柄短暂占用时（EPERM / EBUSY / EACCES）重试，其他错误照常抛出
import * as fs from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../src/store'
import { makeTmp, removeTmp } from './helpers/tmp'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const rename = vi.mocked(fs.renameSync)
const busy = (code: string): Error => Object.assign(new Error(code), { code })
const project = { id: 'p1', name: '项目', path: 'D:\\项目', addedAt: 1 }

let dir: string
beforeEach(() => {
  dir = makeTmp('store-write')
})
afterEach(() => {
  rename.mockClear()
  removeTmp(dir)
})

it('目标被占用时稍等重试，最后写成功', () => {
  rename
    .mockImplementationOnce(() => {
      throw busy('EPERM')
    })
    .mockImplementationOnce(() => {
      throw busy('EBUSY')
    })
  const store = new Store(dir)
  store.saveProjects([project])
  expect(rename).toHaveBeenCalledTimes(3)
  expect(store.loadProjects()).toEqual([project])
})

it('一直被占用就放弃并抛出；其他错误不重试', () => {
  const store = new Store(dir)
  rename.mockImplementation(() => {
    throw busy('EACCES')
  })
  expect(() => store.saveProjects([project])).toThrow('EACCES')
  expect(rename).toHaveBeenCalledTimes(6)

  rename.mockClear()
  rename.mockImplementation(() => {
    throw busy('ENOSPC')
  })
  expect(() => store.saveProjects([project])).toThrow('ENOSPC')
  expect(rename).toHaveBeenCalledTimes(1)
  rename.mockReset()
})
