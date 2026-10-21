// 附件暂存的界面一侧：分块、进度、取消、失败时撤掉半截上传、移除副本
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FILE_STAGE_CHUNK_BYTES } from '@pixelsky/protocol'
import type { FileStageRequest } from '../../../../../shared/types/workspace'
import { discardStaged, releaseStaged, stageFile } from './stage'

const ref = { projectId: 'p' }
type Stage = (r: unknown, request: FileStageRequest) => Promise<{ path?: string }>

function bridge(stage: Stage): FileStageRequest[] {
  const calls: FileStageRequest[] = []
  vi.stubGlobal('window', {
    pixelsky: {
      files: {
        stage: (r: unknown, request: FileStageRequest) => {
          calls.push(request)
          return stage(r, request)
        },
      },
    },
  })
  return calls
}
/** 内存里的 localStorage：记「输入框自己传的副本」用 */
function storage(): void {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  })
}
afterEach(() => vi.unstubAllGlobals())

const ok: Stage = async (_r, request) => (request.action === 'finish' ? { path: '/data/attachments/x/file-a.bin' } : {})
const bigFile = (bytes: number): File => new File([new Uint8Array(bytes)], 'a.bin')

describe('stageFile', () => {
  it('按块顺序传，每块报一次进度，最后拿到路径', async () => {
    const calls = bridge(ok)
    const progress: number[] = []
    const size = FILE_STAGE_CHUNK_BYTES + 10
    const path = await stageFile(bigFile(size), ref, { onProgress: sent => progress.push(sent) })
    expect(path).toBe('/data/attachments/x/file-a.bin')
    expect(calls.map(c => c.action)).toEqual(['begin', 'chunk', 'chunk', 'finish'])
    expect(calls.filter(c => c.action === 'chunk').map(c => (c as { offset: number }).offset)).toEqual([
      0,
      FILE_STAGE_CHUNK_BYTES,
    ])
    expect(progress).toEqual([FILE_STAGE_CHUNK_BYTES, size])
  })

  it('取消：停在下一块之前，撤掉半截上传，抛 AbortError', async () => {
    const controller = new AbortController()
    const calls = bridge(async (r, request) => {
      if (request.action === 'chunk') controller.abort()
      return ok(r, request)
    })
    const error = await stageFile(bigFile(FILE_STAGE_CHUNK_BYTES * 2), ref, { signal: controller.signal }).catch(
      e => e as Error,
    )
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(calls.map(c => c.action)).toEqual(['begin', 'chunk', 'cancel'])
  })

  it('一开始就取消：什么都不发', async () => {
    const calls = bridge(ok)
    const controller = new AbortController()
    controller.abort()
    await expect(stageFile(bigFile(4), ref, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(calls).toEqual([])
  })

  it('中途出错：撤掉半截上传，原样抛出', async () => {
    const calls = bridge(async (r, request) => {
      if (request.action === 'chunk') throw new Error('机器断开了')
      return ok(r, request)
    })
    await expect(stageFile(bigFile(4), ref)).rejects.toThrow('机器断开了')
    expect(calls.map(c => c.action)).toEqual(['begin', 'chunk', 'cancel'])
  })
})

describe('discardStaged', () => {
  const path = '/data/attachments/x/file-a.bin'
  it('输入框自己传的副本：移除附件时删；没有工作区不发，删不掉不报错', async () => {
    storage()
    let fail = false
    const calls = bridge(async (r, request) => {
      if (fail) throw new Error('机器断开了')
      return ok(r, request)
    })
    await stageFile(bigFile(4), ref)
    calls.length = 0
    await discardStaged(path, null)
    expect(calls).toEqual([])
    fail = true
    await expect(discardStaged(path, ref)).resolves.toBeUndefined()
    expect(calls).toEqual([{ action: 'remove', path }])
    // 已经删过一次：不再重复发
    await discardStaged(path, ref)
    expect(calls).toHaveLength(1)
  })

  it('分叉 / 回退放回输入框的副本（不是这个输入框传的）：移除时不删，原消息还要读', async () => {
    storage()
    const calls = bridge(ok)
    await discardStaged('/data/attachments/y/file-from-message.bin', ref)
    expect(calls).toEqual([])
  })

  it('发出去之后：副本归消息了，再从别处移除也不删', async () => {
    storage()
    const calls = bridge(ok)
    await stageFile(bigFile(4), ref)
    releaseStaged([path])
    calls.length = 0
    await discardStaged(path, ref)
    expect(calls).toEqual([])
  })
})
